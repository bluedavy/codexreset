import {defineConfig} from 'vitest/config';
import {cloudflareTest} from '@cloudflare/vitest-pool-workers';
export default defineConfig({test:{include:['test/raid.test.ts']},plugins:[cloudflareTest({wrangler:{configPath:'./wrangler.jsonc'},miniflare:{bindings:{VISITOR_HASH_SALT:'test-salt',ADMIN_RESET_SECRET:'test-admin'}}})]});
