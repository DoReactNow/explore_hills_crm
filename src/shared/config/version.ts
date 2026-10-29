import packageJson from "../../../package.json";

/** The app version, shown by the health check and written by the worker heartbeat. */
export const APP_VERSION: string = packageJson.version;
