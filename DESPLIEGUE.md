# Desplegar en Vercel

Tres pasos. Los dos primeros son cuentas gratuitas.

## 1. Base de datos (Neon)

1. Entra en [neon.tech](https://neon.tech) y crea una cuenta.
2. Crea un proyecto. Región: **Frankfurt** o **París**, las más cercanas.
3. Copia la cadena de conexión. Tiene esta forma:

```
postgresql://usuario:contraseña@ep-algo-123.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

No hace falta crear tablas: la API las crea sola al arrancar.

> Supabase sirve igual. Lo importante es que sea PostgreSQL y que su plan
> gratuito no duerma la base de datos.

## 2. Secreto de sesión

Genera uno y guárdalo:

```bash
openssl rand -base64 48
```

Firma los tokens de sesión. Si cambia, todas las sesiones abiertas se cierran.

## 3. Vercel

1. Sube el repositorio a GitHub.
2. Impórtalo en [vercel.com/new](https://vercel.com/new). No cambies nada en la
   pantalla de configuración: `vercel.json` ya la define.
3. Antes de desplegar, abre **Environment Variables** y añade las dos:

   | Nombre | Valor |
   | ------ | ----- |
   | `POSTGRES_URL` | la cadena de Neon del paso 1 |
   | `AUTH_SECRET` | el resultado del paso 2 |

   Márcalas para *Production*, *Preview* y *Development*.

4. **Deploy**.

## Comprobar que ha ido bien

```bash
curl https://TU-PROYECTO.vercel.app/api/health
```

Debe responder:

```json
{ "status": "ok", "database": true, "time": "..." }
```

Si `database` es `false`, la variable `POSTGRES_URL` no ha llegado a la función:
revisa que esté marcada para *Production* y vuelve a desplegar (las variables
no se aplican a despliegues ya hechos).

## Qué se despliega

- `www/` — la aplicación Angular, servida como estáticos.
- `api/index.ts` — la API. Vercel enruta ahí todo `/api/*` por convención de
  carpeta. Reutiliza el mismo manejador que `server.ts` usa en local, así que
  no hay dos caminos de código que puedan divergir.

## Desarrollo en local

Necesita una base de datos. Con PostgreSQL instalado:

```bash
initdb -D /tmp/garaje-db -U garaje --auth=trust
pg_ctl -D /tmp/garaje-db -o "-p 5432 -h 127.0.0.1" -l /tmp/garaje-db/log start
createdb -h 127.0.0.1 -U garaje garaje
```

Guarda las variables en `.env.local` (ya está en `.gitignore`):

```
POSTGRES_URL=postgres://garaje@127.0.0.1:5432/garaje
AUTH_SECRET=cualquier-cosa-de-mas-de-32-caracteres-para-local
```

Y arranca los dos procesos:

```bash
npm run api:env    # API en :3210, leyendo .env.local
npm start          # app en :4200, con proxy a /api
```

También puedes apuntar `POSTGRES_URL` a la base de datos de Neon y trabajar
contra ella directamente, sin PostgreSQL local.
