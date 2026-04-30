import dotenv from "dotenv";

// Local/dev convenience: load env files if present (without overriding real env).
// Important: this module must be imported before any module that reads process.env at import-time.
dotenv.config({ path: ".env.local", override: false });
dotenv.config({ path: ".env", override: false });

