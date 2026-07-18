// People admin — the curated LTK People roster: list, add/edit (manual
// entry until the Office 365 Users connection exists for Entra search),
// crew / site / department enrichment, deactivate.

import { el } from "../../../shared/ui/dom";
import { detectHost } from "../runtime";
import { RosterPerson } from "../store/mappers";
import { listPeople, upsertPerson } from "../store/people";

export function mountPeople(parent: HTMLElement): () => void {
  void (async () => {
    const hosted = await detectHost();
    if (!hosted) {
      parent.appendChild(
        el("div", "app-board-note", "People admin needs the Power Apps host.")
      );
      return;
    }
    const wrap = el("div", "app-people");
    parent.appendChild(wrap);
    wrap.appendChild(
      el(
        "div",
        "app-board-note",
        "Entra ID search arrives once the Office 365 Users connection exists — add people manually meanwhile."
      )
    );

    const listBox = el("div", "app-people-list");
    const form = el("div", "app-people-form");
    wrap.append(form, listBox);

    const input = (placeholder: string, width = "160px") => {
      const field = el("input", "app-input") as HTMLInputElement;
      field.placeholder = placeholder;
      field.style.width = width;
      return field;
    };
    const name = input("Full name", "200px");
    const email = input("Email", "220px");
    const crew = input("Crew", "70px");
    const site = input("Site");
    const department = input("Department");
    const add = el("button", "app-btn", "＋ Add person") as HTMLButtonElement;
    form.append(name, email, crew, site, department, add);

    const refresh = async () => {
      const people = await listPeople(true);
      listBox.replaceChildren();
      for (const person of people) {
        listBox.appendChild(personRow(person, refresh));
      }
    };

    add.addEventListener("click", () => {
      const who = name.value.trim();
      if (who === "") return;
      void (async () => {
        await upsertPerson({
          // manual entries key on a slug until Entra search supplies the
          // object id; enriching later re-keys nothing (whoId is forever)
          whoId: `manual-${who.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          who,
          email: email.value.trim(),
          crew: crew.value.trim() || undefined,
          site: site.value.trim(),
          department: department.value.trim(),
          active: true,
        });
        [name, email, crew, site, department].forEach((f) => (f.value = ""));
        await refresh();
      })();
    });

    await refresh();
  })();
  return () => undefined;
}

function personRow(person: RosterPerson, refresh: () => Promise<void>): HTMLElement {
  const row = el("div", "app-people-row");
  row.appendChild(el("span", "app-people-name", person.who));
  row.appendChild(
    el(
      "span",
      "app-people-meta",
      [person.email, person.crew && `Crew ${person.crew}`, person.site, person.department]
        .filter(Boolean)
        .join(" · ")
    )
  );
  const toggle = el(
    "button",
    "app-btn",
    person.active ? "Deactivate" : "Reactivate"
  ) as HTMLButtonElement;
  if (!person.active) row.classList.add("app-people-inactive");
  toggle.addEventListener("click", () => {
    void upsertPerson({ ...person, active: !person.active }).then(refresh);
  });
  row.appendChild(toggle);
  return row;
}
