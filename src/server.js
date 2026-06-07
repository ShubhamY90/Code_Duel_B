const app = require("./app");
const http = require("http");

const PORT = process.env.PORT || 4000;
const server = http.createServer(app);

// Socket.io integration will be configured and attached here in later phases

server.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV || "development"} mode`);
  console.log(`🚀 Listening on port ${PORT}`);
  console.log(`🏥 Health check URL: http://localhost:${PORT}/health`);
});
