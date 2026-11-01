# The load test's own environment: a throwaway database and folder, fake providers. Source this file.
set -a
. ./.env.test.example
set +a
export APP_ENV=development LOG_LEVEL=warn APP_PORT=47221 APP_URL=http://127.0.0.1:47221
export NODE_ENV=production STORAGE_LOCAL_DIR=/tmp/explorehills_load_storage
export DATABASE_URL="postgresql://explorehills_user:explorehills_password@127.0.0.1:54329/explorehills_load"
