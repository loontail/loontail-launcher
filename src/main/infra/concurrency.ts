// Caps libuv fan-out so a large bundle install doesn't queue every stat/hash at
// once and starve other main-process work.
export { createLimiter, type Limiter } from '@shared/lib/limiter';
