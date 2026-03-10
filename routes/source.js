'use strict'

const { version, name, license, repository } = require('../package.json')

/**
 * Source Disclosure Route (AGPL Compliance)
 * GET /source - Returns source repository information (unauthenticated)
 */
module.exports = async function (fastify, opts) {
  fastify.get('/source', {
    schema: {
      tags: ['meta'],
      response: {
        200: {
          type: 'object',
          required: ['name', 'version', 'source', 'license'],
          properties: {
            name: { type: 'string' },
            version: { type: 'string' },
            commit: { type: 'string' },
            source: { type: 'string', format: 'uri' },
            license: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    return {
      name,
      version,
      commit: process.env.GIT_COMMIT_SHA || undefined,
      source: repository?.url || process.env.SOURCE_CODE_URL || 'https://github.com/thatalexay/node-image-editing',
      license
    }
  })
}
