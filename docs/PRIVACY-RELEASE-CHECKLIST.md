# Privacy notice release checklist

The canonical [Team 4418 privacy notice](https://team.frc4418.org/privacy.html) is maintained in the Team Hub repository and covers the connected team tools. Keep Pit's sign-in and signed-in links pointed to that notice rather than maintaining a separate copy.

Before shipping a feature or changing a service:

- Check whether the actual data categories, collection purposes, audiences/access, service providers, or retention and deletion practices have changed. Include browser/device storage, queued scouting submissions, exports, and external integrations when relevant.
- If anything changed, review the canonical notice against the implemented behavior and update its relevant sections and review date before or alongside release. Routine edits should truthfully describe approved, existing practices; avoid unsupported promises about retention, security, or deletion.
- Updating the notice does not authorize new collection, new uses, broader sharing/access, a new provider, or a retention change. Obtain any required approval for the underlying change separately before implementing it.
- Record the notice review in the pull request, including changed practices and the associated notice update, or explain why no notice wording change is needed.
- Verify the canonical page remains publicly accessible without signing in, the links work from the auth surface and signed-in footer, and the link opens separately without discarding work. Recheck phone layout, keyboard focus, and the existing sign-in redirect.
