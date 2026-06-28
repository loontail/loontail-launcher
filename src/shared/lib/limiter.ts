export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

// Bound the number of concurrently running async tasks. Callers wrap each unit
// of work in `limit(() => ...)`; at most `max` run at once, the rest queue.
// Lives in the shared layer so both the main process (fs/socket fan-out caps)
// and the renderer (the status seeder's prefetch pool) use one primitive.
export const createLimiter = (max: number): Limiter => {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = (): void => {
    if (active >= max) return;
    const task = queue.shift();
    if (!task) return;
    active += 1;
    task();
  };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
};
