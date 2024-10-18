import { BasePluginService } from '@ayazmo/core';
import { AyazmoInstance, PluginSettings } from '@ayazmo/types';
import pkg from 'rascal';
const { BrokerAsPromised: Broker } = pkg;
import { asFunction } from "awilix"
import { Job } from "bullmq";

type TransformerConfig = {
  [eventName: string]: {
    transformer: (payload: Job | Record<string, any>, app: AyazmoInstance) => Promise<any>;
    routingKey: string;
    options?: Record<string, any>;
  };
};

// Handle shutdown events
const shutdownEvents = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'uncaughtException', 'unhandledRejection'];

export default class RmqService extends BasePluginService {
  private broker: typeof Broker | null = null;
  private eventService: any;
  public connected = false;

  constructor(app: AyazmoInstance, pluginOptions: PluginSettings) {
    super(app, pluginOptions);
    this.eventService = this.container.resolve('eventService');
    const { pubTransformers } = this.pluginSettings;
    const transformersObject = pubTransformers as TransformerConfig;
    this.init(transformersObject, app);
    this.onShutdown();
  }

  async init(transformersObject: any, app: AyazmoInstance) {
    await this.connect();
    for (const eventName in transformersObject) {
      const config = transformersObject[eventName];
      this.eventService.subscribe(eventName, async (payload: Job | Record<string, any>) => {
        if (!payload) {
          app.log.debug(`No payload for event ${eventName}`);
          return;
        }
        app.log.debug(`Processing eventName: ${eventName}`);
        let transformedPayload = payload.data ?? payload;
        try {
          transformedPayload = await config.transformer(transformedPayload, app);
        } catch (error) {
          app.log.error(`Error transforming payload for event ${eventName}: ${error}`);
        }

        if (transformedPayload !== null && transformedPayload !== undefined && this.broker) {
          app.log.debug(`Publishing message to ${eventName}`);
          app.log.debug(transformedPayload);
          await this.publishMessage(eventName, transformedPayload);
        } else {
          app.log.debug(`No payload for event ${eventName}`);
        }
      });
    }
  }

  async connect() {
    if (this.connected) {
      this.app.log.debug('Already connected to RabbitMQ.');
      return;
    }

    try {
      // Get RabbitMQ connection settings from the config
      const rmqConfig = this.pluginSettings;

      // Establish a robust RabbitMQ connection using Rascal
      this.broker = await Broker.create(rmqConfig.connection);
      this.connected = true;

      // Handle connection close event
      this.broker.on('error', (err) => {
        this.app.log.error('Broker error', err);
        this.connected = false;
      });

      this.broker.on('disconnect', () => {
        this.app.log.warn('Broker disconnected');
        this.connected = false; // Set to false on disconnect
        // Consider attempting to reconnect here
      });
    } catch (error) {
      this.app.log.error(`Error connecting to RabbitMQ: ${error}`);
      this.connected = false;
    }
  }

  async publishMessage(routingKey: string, message: any) {
    try {
      const publication = await this.broker.publish(routingKey, JSON.stringify(message));
      publication.on('error', (err) => {
        this.app.log.error(err);
      });
    } catch (error) {
      this.app.log.error(error);
    }
  }

  async close() {
    if (this.broker) {
      await this.broker.shutdown();
      this.broker = null;
      this.connected = false;
    }
  }

  getBroker() {
    return this.broker;
  }

  onShutdown() {
    shutdownEvents.forEach((event) => {
      process.on(event, async () => {
        try {
          await this.close();
          this.app.log.info(`RabbitMQ connection closed due to ${event}`);
          process.exit(0);
        } catch (error) {
          this.app.log.error(`Error closing RabbitMQ connection on ${event}:`, error);
          process.exit(1);
        }
      });
    });
  }
}

export function loader(app: AyazmoInstance, pluginSettings: PluginSettings) {
  app.diContainer.register({
    rmqService: asFunction(
      (cradle) => new RmqService(app, pluginSettings)
    )
  })

  // eagerly load the service
  app.diContainer.resolve('rmqService');
}