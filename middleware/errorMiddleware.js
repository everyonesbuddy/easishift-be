module.exports = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  if (statusCode >= 500) console.error("Error 💥", err);
  res.status(statusCode).json({
    status: "error",
    message: err.message || "Internal Server Error",
    ...(err.errorCode ? { errorCode: err.errorCode } : {}),
    ...(err.details && typeof err.details === "object" ? err.details : {}),
  });
};
