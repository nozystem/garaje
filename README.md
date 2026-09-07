# Garaje

Control de mantenimiento de vehículos. Registra tus coches y motos, apunta lo
que les vas haciendo, y la app calcula qué toca y cuándo —por kilómetros, por
tiempo, o por lo que se cumpla antes.

**Ionic 9 · Angular 22 · TypeScript · API en Node · PostgreSQL**

## Qué hace

- **Vehículos** con foto, matrícula, kilometraje y consumo mensual estimado.
- **Planes de mantenimiento** con intervalos por kilómetros y/o meses, a partir
  de una lista de tareas habituales (aceite, frenos, ITV, distribución…).
- **Avisos** ordenados por urgencia, con la fecha estimada de vencimiento
  proyectada según el uso real del vehículo.
- **Historial** de intervenciones con coste y taller.
- **Catálogo** de 89 marcas y 1.848 modelos servido por la API.

## Lo que tiene de interesante

El **cálculo de vencimientos** ([`maintenance-calculator.ts`](src/app/core/services/maintenance-calculator.ts))
es el núcleo del proyecto. Un plan puede vencer por kilómetros, por tiempo o
por ambos; cuando hay dos criterios manda el que se agote antes, que es como
están escritos los libros de mantenimiento ("cada 15.000 km o 12 meses, lo que
ocurra primero"). Está aislado del framework y cubierto por tests.

Tres **reglas de negocio viven en el servidor**, no en el cliente:

- Registrar un mantenimiento con más kilómetros de los conocidos actualiza el
  cuentakilómetros del vehículo; uno antiguo no lo hace retroceder.
- Cerrar una tarea planificada la reprograma automáticamente.
- Borrar un vehículo arrastra su historial y sus planes.

El **catálogo de vehículos** fusiona el dataset abierto
[open-vehicle-db](https://github.com/plowman/open-vehicle-db) con un catálogo
propio para el parque español: el dataset original no incluye SEAT, Cupra,
Dacia, Škoda, Citroën, Opel ni Volkswagen, y de Renault solo trae los modelos
que se vendieron en EE.UU. en los ochenta. Se evaluaron también NHTSA vPIC
(sin marcas europeas), CarQueryAPI (fuera de servicio) y auto-data.net
(comercial). Ver [`server/lib/catalog.ts`](server/lib/catalog.ts).

## Requisitos

Node 22.

```bash
nvm use 22
npm install --legacy-peer-deps
```

> El flag es necesario por un fallo de resolución de peers de npm 10.9 con
> vitest. No afecta a las versiones instaladas.

## Desarrollo

Dos procesos: la API y la app.

```bash
npm run api      # API en localhost:3210
npm start        # app en localhost:4200, con proxy a /api
```

La API arranca sin base de datos y guarda en memoria, así que se puede probar
sin configurar nada. La app lo advierte en pantalla.

## Comandos

| Comando | Qué hace |
| ------- | -------- |
| `npm start` | Servidor de desarrollo |
| `npm run api` | API en local, con recarga |
| `npm run build` | Build de producción en `www/` |
| `npm test` | Tests (vitest) |
| `npm run lint` | ESLint |
| `node scripts/fetch-vehicle-db.mjs` | Actualiza el catálogo externo |

## Base de datos

Sin `POSTGRES_URL` la API guarda en memoria. Con la variable definida crea las
tablas sola al arrancar:

```bash
POSTGRES_URL="postgres://usuario:clave@host/base" npm run api
```

## Despliegue

Configurado para Vercel en [`vercel.json`](vercel.json): `server.ts` se
despliega como función y sirve `/api/*`, y el resto de rutas van a la SPA.

1. Sube el repositorio a GitHub e impórtalo en [vercel.com/new](https://vercel.com/new).
2. Añade la variable de entorno `POSTGRES_URL` con una base de datos Postgres
   (Vercel Postgres, Neon o Supabase tienen plan gratuito).
3. Despliega. Cada push a la rama principal actualiza el sitio.

Sin `POSTGRES_URL` el despliegue funciona igual, pero en modo demostración: los
datos no sobreviven al reciclado de la función.

## App móvil

La versión web funciona como PWA. Para generar un binario nativo:

```bash
npm install @capacitor/core @capacitor/cli --legacy-peer-deps
npx cap init garaje com.sergiorubio.garaje --web-dir=www

npm install @capacitor/android --legacy-peer-deps
npx cap add android
npm run build && npx cap sync
npx cap open android
```

Tras cada `npm run build` hay que ejecutar `npx cap sync`.

## Estructura

```
server.ts                 Punto de entrada de la API
server/lib/               Enrutado, validación, almacenamiento y catálogo
server/data/              Catálogo externo descargado
src/app/core/             Modelos, cálculo de vencimientos y estado
src/app/pages/            Pantallas
src/app/shared/           Componentes y pipes reutilizables
scripts/                  Utilidades de mantenimiento del proyecto
```

## Identificación

No hay cuentas. El navegador genera un identificador de garaje y lo envía en la
cabecera `x-garage-id`. Se puede copiar desde Ajustes para abrir el mismo
garaje en otro dispositivo. No es autenticación: quien tenga el identificador
ve el garaje, y la app lo advierte.
