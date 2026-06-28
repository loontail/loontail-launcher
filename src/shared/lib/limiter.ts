export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

// At most `max` tasks run at once, the rest queue. Shared so both the main
// process and the renderer's prefetch pool use one concurrency primitive.
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
