export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
  child: (fields: LogFields) => Logger;
}

const write = (level: LogLevel, component: string, baseFields: LogFields, event: string, fields: LogFields) => {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      component,
      ...baseFields,
      ...fields,
    }),
  );
};

export const createLogger = (component: string, baseFields: LogFields = {}): Logger => ({
  debug: (event, fields = {}) => write("debug", component, baseFields, event, fields),
  info: (event, fields = {}) => write("info", component, baseFields, event, fields),
  warn: (event, fields = {}) => write("warn", component, baseFields, event, fields),
  error: (event, fields = {}) => write("error", component, baseFields, event, fields),
  child: (fields) => createLogger(component, { ...baseFields, ...fields }),
});
