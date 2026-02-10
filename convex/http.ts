// convex/http.ts
import { httpRouter } from "convex/server";

import { authKit } from "./auth";

const http = httpRouter();

// Register WorkOS AuthKit webhook routes
authKit.registerRoutes(http);

export default http;
