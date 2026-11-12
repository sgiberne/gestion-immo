// Exécution d'une tâche asynchrone sur une liste, avec un nombre limité de tâches simultanées.

/**
 * Applique `fn` à chaque élément, `limit` à la fois, et renvoie les résultats dans l'ordre des éléments.
 * À la première erreur, plus aucun nouvel élément n'est lancé et l'erreur est propagée
 * (les tâches déjà en cours se terminent).
 */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
