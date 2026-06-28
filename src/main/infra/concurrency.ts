// Caps libuv fan-out so a large bundle install doesn't queue every stat/hash at
// once and starve other main-process work.
export { type Limiter, createLimiter } from '@shared/lib/limiter';
