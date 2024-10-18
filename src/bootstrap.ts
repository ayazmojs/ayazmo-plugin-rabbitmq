import { AyazmoInstance, PluginConfig, PluginSettings } from "@ayazmo/types"

function validateTransformersAndPublications(settings: PluginSettings) {
  const { pubTransformers } = settings;
  const vhosts = settings.connection.vhosts;

  for (const transformerKey of Object.keys(pubTransformers)) {
    let hasCorrespondingPublication = false;

    for (const vhost in vhosts) {
      const { publications } = vhosts[vhost];
      if (publications && publications[transformerKey]) {
        hasCorrespondingPublication = true;
        break;
      }
    }

    if (!hasCorrespondingPublication) {
      console.warn(`Warning: Transformer '${transformerKey}' does not have a corresponding publication definition in any vhost.`);
    }
  }
}

export default async (app: AyazmoInstance, pluginConfig: PluginConfig) => {
  if (!pluginConfig.settings.connection) {
    throw new Error("Missing rabbitmq config")
  }

  if (!pluginConfig.settings.pubTransformers || Object.keys(pluginConfig.settings.pubTransformers).length === 0) {
    throw new Error("Missing transformers config")
  }

  validateTransformersAndPublications(pluginConfig.settings)
}