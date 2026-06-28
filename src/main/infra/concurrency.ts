// Re-exported from the shared layer so the main process (fs/socket fan-out caps)
// and the renderer (status-seeder prefetch pool) share one primitive. Used to
// cap libuv fan-out so a large bundle install doesn't queue every stat/hash at
// once and starve other main-process work behind a busy pool.
export { type Limiter, createLimiter } from '@shared/lib/limiter';
