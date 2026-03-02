import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

export type StationEventSeverity = "debug" | "info" | "warn" | "error";

export interface StationEventSourceV1 {
  readonly agentId: string;
  readonly workspaceId: string;
  readonly laneId: string;
  readonly sessionId: string;
}

export interface StationEventV1 {
  readonly version: "1.0";
  readonly eventId: string;
  readonly occurredAt: string;
  readonly eventType: string;
  readonly severity: StationEventSeverity;
  readonly source: StationEventSourceV1;
  readonly payload: Record<string, unknown>;
}

export interface StationEventValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ErrorObject[];
}

export const stationEventV1Schema = {
  $id: "https://schemas.openclaw.dev/station-event.v1.json",
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "eventId",
    "occurredAt",
    "eventType",
    "severity",
    "source",
    "payload",
  ],
  properties: {
    version: {
      type: "string",
      const: "1.0",
    },
    eventId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    occurredAt: {
      type: "string",
      format: "date-time",
    },
    eventType: {
      type: "string",
      minLength: 1,
      maxLength: 120,
    },
    severity: {
      type: "string",
      enum: ["debug", "info", "warn", "error"],
    },
    source: {
      type: "object",
      additionalProperties: false,
      required: ["agentId", "workspaceId", "laneId", "sessionId"],
      properties: {
        agentId: { type: "string", minLength: 1 },
        workspaceId: { type: "string", minLength: 1 },
        laneId: { type: "string", minLength: 1 },
        sessionId: { type: "string", minLength: 1 },
      },
    },
    payload: {
      type: "object",
      additionalProperties: true,
    },
  },
  allOf: [
    {
      if: {
        properties: {
          eventType: { const: "lane.enqueue" },
        },
        required: ["eventType"],
      },
      then: {
        properties: {
          payload: {
            type: "object",
            additionalProperties: false,
            required: ["queueDepth", "position"],
            properties: {
              queueDepth: { type: "integer", minimum: 0 },
              position: { type: "integer", minimum: 0 },
            },
          },
        },
      },
    },
    {
      if: {
        properties: {
          eventType: { const: "approval.requested" },
        },
        required: ["eventType"],
      },
      then: {
        properties: {
          payload: {
            type: "object",
            additionalProperties: false,
            required: ["approvalId", "command"],
            properties: {
              approvalId: { type: "string", minLength: 1 },
              command: { type: "string", minLength: 1 },
            },
          },
        },
      },
    },
  ],
} as const;

const ajv = new (Ajv as unknown as new (options: { allErrors: boolean; strict: boolean }) => {
  compile: (schema: unknown) => ((value: unknown) => boolean) & { errors?: readonly ErrorObject[] | null };
})({
  allErrors: true,
  strict: false,
});

(addFormats as unknown as (instance: unknown) => void)(ajv);

const validator = ajv.compile(stationEventV1Schema);

export class StationEventValidationError extends Error {
  public readonly errors: readonly ErrorObject[];

  public constructor(errors: readonly ErrorObject[]) {
    super("StationEventV1 validation failed");
    this.name = "StationEventValidationError";
    this.errors = errors;
  }
}

function collectErrors(): readonly ErrorObject[] {
  return validator.errors ? [...validator.errors] : [];
}

export function validateStationEventV1(event: unknown): StationEventValidationResult {
  const valid = validator(event);
  if (valid) {
    return {
      valid: true,
      errors: [],
    };
  }

  return {
    valid: false,
    errors: collectErrors(),
  };
}

export function isStationEventV1(event: unknown): event is StationEventV1 {
  return validateStationEventV1(event).valid;
}

export function assertStationEventV1(event: unknown): StationEventV1 {
  const validation = validateStationEventV1(event);
  if (!validation.valid) {
    throw new StationEventValidationError(validation.errors);
  }

  return event as StationEventV1;
}
