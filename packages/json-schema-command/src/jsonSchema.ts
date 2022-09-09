import { FromSchema, JSONSchema } from 'json-schema-to-ts';

import {
  Command,
  EventAlreadyExistsError,
  EventStore,
  TimeoutError,
} from '@castore/core';

export type OnEventAlreadyExistsCallback = (
  error: EventAlreadyExistsError,
  context: { attemptNumber: number; retriesLeft: number },
) => Promise<void>;

export class JSONSchemaCommand<
  $E extends EventStore[] = EventStore[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  E extends EventStore[] = EventStore[] extends $E ? any : $E,
  IS extends JSONSchema | undefined = JSONSchema | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  I = IS extends JSONSchema ? FromSchema<IS> : any,
  OS extends JSONSchema | undefined = JSONSchema | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  O = OS extends JSONSchema ? FromSchema<OS> : any,
> implements Command<$E, E, I, O>
{
  // @ts-ignore _types only
  _types: {
    input: I;
    output: O;
  };
  commandId: string;
  requiredEventStores: $E;
  inputSchema?: IS;
  outputSchema?: OS;
  eventAlreadyExistsRetries: number;
  onEventAlreadyExists: OnEventAlreadyExistsCallback;
  handler: (
    input: I,
    requiredEventStores: E,
    options?: { timeout?: number },
  ) => Promise<O>;

  constructor({
    commandId,
    requiredEventStores,
    inputSchema,
    outputSchema,
    eventAlreadyExistsRetries = 2,
    onEventAlreadyExists = async () => new Promise(resolve => resolve()),
    handler,
  }: {
    commandId: string;
    requiredEventStores: $E;
    inputSchema?: IS;
    outputSchema?: OS;
    eventAlreadyExistsRetries?: number;
    onEventAlreadyExists?: OnEventAlreadyExistsCallback;
    handler: (input: I, requiredEventStores: E) => Promise<O>;
  }) {
    this.commandId = commandId;
    this.requiredEventStores = requiredEventStores;
    this.eventAlreadyExistsRetries = eventAlreadyExistsRetries;
    this.onEventAlreadyExists = onEventAlreadyExists;

    if (inputSchema !== undefined) {
      this.inputSchema = inputSchema;
    }

    if (outputSchema !== undefined) {
      this.outputSchema = outputSchema;
    }

    this.handler = async (input, eventStores, options) => {
      let retriesLeft = this.eventAlreadyExistsRetries;
      let attemptNumber = 1;

      while (retriesLeft >= 0) {
        try {
          const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(
                new TimeoutError({
                  commandId,
                  timeout: options?.timeout,
                }),
              );
            }, options?.timeout);
          });

          const promise = new Promise((resolve, reject) => {
            handler(input, eventStores).then(resolve).catch(reject);
          });

          // returns a race between timeout and the passed promise
          const output = await Promise.race<T>([promise, timeout]);

          return output as O;
        } catch (error) {
          if (!(error instanceof EventAlreadyExistsError)) {
            throw error;
          }

          await this.onEventAlreadyExists(error, {
            attemptNumber,
            retriesLeft,
          });

          if (retriesLeft === 0) {
            throw error;
          }
          console.log('..retrying');
          retriesLeft -= 1;
          attemptNumber += 1;
        }
      }

      /**
       * @debt interface "find a better thing to do in this case (which should not happen anyway)"
       */
      throw new Error('Handler failed to execute');
    };
  }
}
