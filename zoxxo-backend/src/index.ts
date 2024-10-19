import express from "express";
import { DotenvPopulateInput, config, populate } from "dotenv";
import cors from "cors";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import middleware from "i18next-http-middleware";
import router from "./routes";
import errorMiddleware from "./services/errorMiddleware";
import i18n from "./i18n";

// Load environment variables
config();
populate(process.env as DotenvPopulateInput, { JWT_SECRET: "zoxxo-secret" });

const app = express();

// CORS configuration
const corsOptions = {
  origin: [
    "http://localhost:8000",
    "http://localhost:9000",
    "https://www.zoxxo.io",
    "https://zoxxo.io",

    // zedfoundation.de configuration
    "https://zoxxo-dev.ey.r.appspot.com", //app engine ->services->default(url)
    "https://zedfoundation.de", //custom domain for website
    "https://fdownload.zoxxo.io", //cloud run domain mapping
    "https://fzip.zoxxo.io", // cloud run domain mapping

    // dev.zoxxo.io configuration
    "https://dev.zoxxo.io", //app engine ->services->default(url)
    "https://zoxxo-developer-434914.ey.r.appspot.com/", //custom domain for website
    "https://devdownload.zoxxo.io", //cloud run domain mapping
    "https://devzip.zoxxo.io", // cloud run domain mapping
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
  credentials: true,
};

// Middleware setup
app.use(cors(corsOptions));
app.use(middleware.handle(i18n));
app.use(
  express.json({
    verify: (req, res, buf) => ((req as any).rawBody = buf),
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Routes
app.use("/api", router);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).send("Healthy");
});

// Error middleware
app.use(errorMiddleware);

// Server and Database setup
const PORT = process.env.PORT || 8080;
const MONGODB_URI = process.env.MONGODB_URI || "";

const startServer = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB");
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("DB connection failed. Server could not start");
    console.error(error);
    process.exit(1);
  }
};

startServer();

export default app;
