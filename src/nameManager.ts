import { escapeHtml, $ } from "./util";

export interface Item {
  id: string;
  name: string;
  info: string;
  blocked?: string; // raison pour laquelle la suppression est impossible
}

export interface ManagerOptions {
  title: string; // HTML
  intro: string;
  placeholder: string;
  addLabel: string;
  confirmDelete: string;
  load(): Promise<Item[]>;
  add(name: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  afterChange?(): Promise<void>;
}

/** Page de gestion « liste de noms » : ajout, modification, suppression. */
export async function renderNameManager(box: HTMLElement, o: ManagerOptions): Promise<void> {
  let items = await o.load();
  let editing: string | null = null;

  const rowHtml = (it: Item): string =>
    editing === it.id
      ? `<tr>
          <td><input class="edit" maxlength="80" value="${escapeHtml(it.name)}" /></td>
          <td>${escapeHtml(it.info)}</td>
          <td class="num"><button data-act="save" data-id="${it.id}">Enregistrer</button>
            <button class="ghost" data-act="cancel">Annuler</button></td>
        </tr>`
      : `<tr>
          <td>${escapeHtml(it.name)}</td>
          <td>${escapeHtml(it.info)}</td>
          <td class="num">
            <button class="ghost" data-act="edit" data-id="${it.id}">Modifier</button>
            <button class="ghost danger" data-act="delete" data-id="${it.id}"
              ${it.blocked ? `disabled title="${escapeHtml(it.blocked)}"` : ""}>Supprimer</button>
          </td>
        </tr>`;

  const draw = (): void => {
    box.innerHTML = `
      <h1>${o.title}</h1>
      <p class="muted">${o.intro}</p>
      <section class="card">
        <form class="add-form">
          <input name="name" required maxlength="80" placeholder="${escapeHtml(o.placeholder)}" />
          <button type="submit">${escapeHtml(o.addLabel)}</button>
        </form>
      </section>
      <section class="card">
        <table>
          <thead><tr><th>Nom</th><th>Utilisation</th><th></th></tr></thead>
          <tbody>${items.map(rowHtml).join("")}</tbody>
        </table>
      </section>`;
    if (editing) $<HTMLInputElement>(box, ".edit").focus();
  };

  const apply = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
      editing = null;
      items = await o.load();
      draw();
      await o.afterChange?.();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const save = (id: string): Promise<void> => apply(() => o.rename(id, $<HTMLInputElement>(box, ".edit").value));

  box.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = $<HTMLInputElement>(box, ".add-form input");
    void apply(() => o.add(input.value));
  });

  box.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const id = btn.dataset.id ?? "";
    switch (btn.dataset.act) {
      case "edit": editing = id; draw(); break;
      case "cancel": editing = null; draw(); break;
      case "save": void save(id); break;
      case "delete":
        if (confirm(o.confirmDelete)) void apply(() => o.remove(id));
        break;
    }
  });

  box.addEventListener("keydown", (ev) => {
    if (!(ev.target as HTMLElement).matches(".edit")) return;
    if (ev.key === "Enter" && editing) void save(editing);
    if (ev.key === "Escape") { editing = null; draw(); }
  });

  draw();
}
