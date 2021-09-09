'use strict';

const { isEmpty, mergeWith, isArray } = require('lodash/fp');
const { ApolloServer } = require('apollo-server-koa');
const {
  ApolloServerPluginLandingPageLocalDefault,
  ApolloServerPluginLandingPageProductionDefault,
} = require('apollo-server-core');
const depthLimit = require('graphql-depth-limit');
const { graphqlUploadKoa } = require('graphql-upload');

const merge = mergeWith((a, b) => {
  if (isArray(a) && isArray(b)) {
    return a.concat(b);
  }
});

module.exports = async strapi => {
  // Generate the GraphQL schema for the content API
  const schema = strapi
    .plugin('graphql')
    .service('content-api')
    .buildSchema();

  if (isEmpty(schema)) {
    strapi.log.warn('The GraphQL schema has not been generated because it is empty');

    return;
  }

  const { config } = strapi.plugin('graphql');

  const defaultServerConfig = {
    // Schema
    schema,

    // Initialize loaders for this request.
    context: ({ ctx }) => {
      // TODO: set loaders in the context not globally
      strapi
        .plugin('graphql')
        .service('old')
        ['data-loaders'].initializeLoader();

      return ctx;
    },

    // Validation
    validationRules: [depthLimit(config('depthLimit'))],

    // Misc
    cors: false,
    uploads: false,
    bodyParserConfig: true,

    plugins: [
      // Specify which GraphQL landing page we want for the different env.
      process.env.NODE_ENV !== 'production'
        ? ApolloServerPluginLandingPageLocalDefault({ footer: false })
        : ApolloServerPluginLandingPageProductionDefault({ footer: false }),
    ],
  };

  const serverConfig = merge(defaultServerConfig, config('apolloServer', {}));

  // Create a new Apollo server
  const server = new ApolloServer(serverConfig);

  // Register the upload middleware
  useUploadMiddleware(strapi, config);

  try {
    // Since Apollo-Server v3, server.start() must be called before using server.applyMiddleware()
    await server.start();
  } catch (e) {
    strapi.log.error('Failed to start the Apollo server', e.message);
  }

  // Link the Apollo server & the Strapi app
  server.applyMiddleware({
    app: strapi.server.app,
    path: config('endpoint', '/graphql'),
  });

  // Register destroy behavior
  // We're doing it here instead of exposing a destroy method to the strapi-server.js
  // file since we need to have access to the ApolloServer instance
  strapi.plugin('graphql').destroy = async () => {
    await server.stop();
  };
};

/**
 * Register the upload middleware powered by graphql-upload in Strapi
 * @param {object} strapi
 * @param {function} config
 */
const useUploadMiddleware = (strapi, config) => {
  const uploadMiddleware = graphqlUploadKoa();

  strapi.server.app.use((ctx, next) => {
    if (ctx.path === config('endpoint')) {
      return uploadMiddleware(ctx, next);
    }

    return next();
  });
};