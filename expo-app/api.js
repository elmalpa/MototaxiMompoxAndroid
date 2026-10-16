let unauthorizedHandler;
export function onUnauthorized(handler) { unauthorizedHandler = handler; }

export async function apiRequest(apiBaseUrl, path, { method = 'GET', token, body } = {}) {
  if (!apiBaseUrl) throw new Error('La conexion al servicio no esta configurada. Contacta a soporte.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method, signal: controller.signal,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error('El servidor envio una respuesta invalida. Intenta nuevamente.'); }
    if (!response.ok) {
      const error = Object.assign(new Error(data.error || 'No se pudo completar la solicitud.'), { status: response.status });
      if (response.status === 401 && token) unauthorizedHandler?.();
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('El servicio tardo demasiado. Comprueba tu conexion e intenta nuevamente.');
    if (error instanceof TypeError) throw new Error('Sin conexion al servicio. Comprueba internet e intenta nuevamente.');
    throw error;
  } finally { clearTimeout(timer); }
}
export function apiCommand(base, path, options = {}) {
  return apiRequest(base, path, { method: 'PATCH', ...options });
}
