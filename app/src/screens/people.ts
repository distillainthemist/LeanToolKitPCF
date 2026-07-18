// People admin — the curated LTK People roster: Entra ID search-to-add
// (Office 365 Users connector), manual entry fallback, crew / site /
// department enrichment, deactivate.

import { clear, el } from "../../../shared/ui/dom";
import { detectHost } from "../runtime";
import { RosterPerson } from "../store/mappers";
import { EntraHit, listPeople, searchEntra, upsertPerson } from "../store/people";

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

    const listBox = el("div", "app-people-list");
    const search = el("div", "app-people-search");
    const form = el("div", "app-people-form");
    wrap.append(search, form, listBox);

    const input = (placeholder: string, width = "160px") => {
      const field = el("input", "app-input") as HTMLInputElement;
      field.placeholder = placeholder;
      field.style.width = width;
      return field;
    };

    // ---- Entra search-to-add ----
    const query = input("Search Entra ID (name or email)…", "280px");
    const hitsBox = el("div", "app-people-hits");
    search.append(query, hitsBox);

    const refresh = async () => {
      const people = await listPeople(true);
      listBox.replaceChildren();
      for (const person of people) {
        listBox.appendChild(personRow(person, refresh));
      }
    };

    const renderHits = (hits: EntraHit[], known: Set<string>) => {
      clear(hitsBox);
      for (const hit of hits) {
        const row = el("div", "app-people-hit");
        row.appendChild(el("span", "app-people-name", hit.displayName));
        row.appendChild(
          el(
            "span",
            "app-people-meta",
            [hit.mail, hit.department].filter(Boolean).join(" · ")
          )
        );
        if (known.has(hit.objectId)) {
          row.appendChild(el("span", "app-people-onroster", "on the roster"));
        } else {
          const addHit = el("button", "app-btn", "＋ Add") as HTMLButtonElement;
          addHit.addEventListener("click", () => {
            void (async () => {
              await upsertPerson({
                whoId: hit.objectId, // Entra object id = whoId, forever
                who: hit.displayName,
                email: hit.mail,
                site: "",
                department: hit.department,
                active: true,
              });
              clear(hitsBox);
              query.value = "";
              await refresh();
            })();
          });
          row.appendChild(addHit);
        }
        hitsBox.appendChild(row);
      }
    };

    let searchSeq = 0;
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    query.addEventListener("input", () => {
      if (searchTimer !== null) clearTimeout(searchTimer);
      const q = query.value.trim();
      if (q.length < 2) {
        clear(hitsBox);
        return;
      }
      searchTimer = setTimeout(() => {
        const seq = ++searchSeq;
        void (async () => {
          try {
            const [hits, roster] = await Promise.all([searchEntra(q), listPeople(true)]);
            if (seq !== searchSeq) return; // a newer search superseded this one
            renderHits(hits, new Set(roster.map((p) => p.whoId)));
          } catch (err) {
            if (seq !== searchSeq) return;
            clear(hitsBox);
            hitsBox.appendChild(
              el(
                "div",
                "app-board-note",
                `Entra search failed: ${err instanceof Error ? err.message : String(err)}`
              )
            );
          }
        })();
      }, 350);
    });

    // ---- manual entry fallback (contractors etc. without Entra accounts) ----
    const name = input("Full name (manual add)", "200px");
    const email = input("Email", "220px");
    const crew = input("Crew", "70px");
    const site = input("Site");
    const department = input("Department");
    const add = el("button", "app-btn", "＋ Add person") as HTMLButtonElement;
    form.append(name, email, crew, site, department, add);

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
