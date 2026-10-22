/**
 * The PUBLISHED schema definition for the pdftojson public contract (AD-4).
 *
 * A JSON Schema (Draft 2020-12) object that documents the versioned contract
 * emitted by `renderJson`. It is a **typed TS constant** (not an imported
 * `.json`) so it lives inside the composite build with no `resolveJsonModule`
 * change and adds no dependency — `core` stays pure (AD-1). `bbox` / `confidence`
 * appear in `properties` but never in any `required` array, so a block validates
 * whether or not the provider supplied them (optional best-effort, AD-4).
 */
import { PDFTOJSON_SCHEMA_VERSION } from './json';

const blockBaseProps = {
  page: { type: 'integer', minimum: 1 },
  bbox: {
    type: 'object',
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
    },
    required: ['x', 'y', 'width', 'height'],
    additionalProperties: false,
  },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
} as const;

/** JSON Schema (Draft 2020-12) documenting the pdftojson v1.0 contract. */
export const PDFTOJSON_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://datadosomething.example/schemas/pdftojson/${PDFTOJSON_SCHEMA_VERSION}.json`,
  title: 'pdftojson document',
  type: 'object',
  required: ['schema_version', 'source', 'blocks'],
  additionalProperties: false,
  properties: {
    schema_version: { const: PDFTOJSON_SCHEMA_VERSION },
    source: {
      type: 'object',
      required: ['type', 'pages', 'provider'],
      additionalProperties: false,
      properties: {
        type: { type: 'string' },
        pages: { type: 'integer', minimum: 0 },
        provider: { type: 'string' },
      },
    },
    blocks: {
      type: 'array',
      items: { $ref: '#/$defs/block' },
    },
  },
  $defs: {
    block: {
      oneOf: [
        { $ref: '#/$defs/heading' },
        { $ref: '#/$defs/paragraph' },
        { $ref: '#/$defs/list' },
        { $ref: '#/$defs/table' },
        { $ref: '#/$defs/code' },
      ],
    },
    heading: {
      type: 'object',
      required: ['type', 'level', 'text', 'page'],
      additionalProperties: false,
      properties: {
        type: { const: 'heading' },
        level: { type: 'integer', minimum: 1, maximum: 6 },
        text: { type: 'string' },
        ...blockBaseProps,
      },
    },
    paragraph: {
      type: 'object',
      required: ['type', 'text', 'page'],
      additionalProperties: false,
      properties: {
        type: { const: 'paragraph' },
        text: { type: 'string' },
        ...blockBaseProps,
      },
    },
    list: {
      type: 'object',
      required: ['type', 'ordered', 'items', 'page'],
      additionalProperties: false,
      properties: {
        type: { const: 'list' },
        ordered: { type: 'boolean' },
        items: { type: 'array', items: { type: 'string' } },
        ...blockBaseProps,
      },
    },
    table: {
      type: 'object',
      required: ['type', 'rows', 'page'],
      additionalProperties: false,
      properties: {
        type: { const: 'table' },
        rows: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
        },
        ...blockBaseProps,
      },
    },
    code: {
      type: 'object',
      required: ['type', 'text', 'page'],
      additionalProperties: false,
      properties: {
        type: { const: 'code' },
        language: { type: 'string' },
        text: { type: 'string' },
        ...blockBaseProps,
      },
    },
  },
} as const;
