// One schema, imported by every app. Both the web app's Drizzle adapter and the
// API's queries read these definitions, so a column can never mean two things.
export * from "./app";
export * from "./auth";
