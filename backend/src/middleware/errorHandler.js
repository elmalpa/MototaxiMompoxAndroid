const errorHandler = (err, req, res, next) => {
  console.error(`[Error] ${err.message}`);
  
  const status = err.status || 500;
  const message = err.message || 'Ocurrió un error inesperado en el servidor';

  res.status(status).json({
    success: false,
    error: message
  });
};

module.exports = errorHandler;