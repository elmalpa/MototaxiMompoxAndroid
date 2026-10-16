const errorHandler = (err, req, res, next) => {
  console.error(`[Error] ${err.message}`);
  
  const status = err.status || 500;
  const message = status >= 500 ? 'No se pudo completar la solicitud. Intenta nuevamente.' : (err.message || 'Solicitud invalida');

  res.status(status).json({
    success: false,
    error: message
  });
};

module.exports = errorHandler;
