# Issue tracker

## Configuration

- Tracker: GitHub Issues
- Repository: `CWen001/JarvisHub`
- CLI: `gh`
- Include pull requests in the triage queue: no

## Consumer rules

Issues in this repository's GitHub Issues are the source of truth for tracked work.

Engineering skills should use the GitHub CLI to interact with issues:

- List or search issues with `gh issue list`.
- Read an issue with `gh issue view`.
- Create an issue with `gh issue create`.
- Update an issue with `gh issue edit`.
- Add comments with `gh issue comment`.

Do not treat pull requests as incoming triage items. Pull requests may reference or close issues, but the issue queue remains the request surface.
