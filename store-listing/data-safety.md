# Borrador de Seguridad de los datos

Este archivo sirve como guía para completar el formulario de Play Console. Debe
compararse con la infraestructura y proveedores definitivos antes de enviarlo.

## Datos recopilados

| Tipo | Finalidad | Obligatorio | Compartido |
|---|---|---:|---:|
| Nombre | Gestión de cuenta y servicio | Sí | Con participantes autorizados del viaje |
| Teléfono | Cuenta, seguridad y contacto durante el viaje | Sí | Con la contraparte asignada |
| Contraseña | Autenticación; se almacena como hash | Sí | No |
| Placa del vehículo | Identificación del conductor | Para conductor | Con el cliente asignado |
| Origen y destino | Prestación del servicio | Sí para solicitar viaje | Con conductores autorizados |
| Coordenadas del viaje | Prestación del servicio, si se habilitan | No, con consentimiento | Con participantes autorizados |
| Historial y estado de viajes | Operación, soporte y seguridad | Sí | Con administradores autorizados |
| Precio y contraoferta | Operación del servicio | Sí | Con participantes del viaje |
| Calificación y comentario | Calidad y soporte | No | Con administradores autorizados |
| Token de notificaciones | Notificaciones operativas | No | Con Expo/Firebase |

## Seguridad declarable

- Datos transmitidos usando HTTPS en producción.
- Contraseñas almacenadas con hash bcrypt.
- Sesión almacenada en el dispositivo mediante almacenamiento seguro.
- El usuario puede solicitar eliminación desde la aplicación.

## Advertencias

- No declarar ubicación precisa como recopilada hasta confirmar si se habilitará GPS.
- Confirmar las prácticas de Render, proveedor SQL, Expo y Firebase.
- La política publicada debe coincidir exactamente con este formulario.

- Se recopilan reportes de soporte y codigos de verificacion de telefono (almacenados como HMAC). Revisar los proveedores de mapas y SMS antes de enviar el formulario.
