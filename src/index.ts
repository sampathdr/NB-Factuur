import { Hono } from "hono";
import { Env } from "./types";
import authRoutes from "./routes/auth";
import companyRoutes from "./routes/companies";
import clientRoutes from "./routes/clients";
import invoiceRoutes from "./routes/invoices";

const app = new Hono<{ Bindings: Env }>();

app.route("/auth", authRoutes);
app.route("/api/companies", companyRoutes);
app.route("/api/clients", clientRoutes);
app.route("/api/invoices", invoiceRoutes);

app.get("/api/health", (c) => c.json({ ok: true }));

// Static assets (public/) are served automatically by the Workers assets
// binding before requests reach this fetch handler; this is the fallback
// for anything that doesn't match a static file or an API route above.
app.notFound((c) => c.text("Not found", 404));

export default app;
