# Portfolio hub

1. Put these files in a repo named `<username>.github.io` and enable Pages (Settings > Pages > deploy from branch).
2. Edit `projects.config.json` (user, tagline, featured repos).
3. Settings > Actions > General > Workflow permissions: allow read and write.
4. Actions tab > "Update projects" > Run workflow. It then refreshes daily.

Repos with several projects: add a `portfolio.json` at that repo's root:
{ "projects": [ { "name": "Unit testing", "path": "01-unit", "description": "...", "topics": ["junit"] } ] }
Each path should contain a README.md.

Pin a project: add its name to "featured" in projects.config.json, or give the repo the GitHub topic "featured".

Maven multi-module repos: to turn every module in the root pom.xml into its own project, either list the repo in
"autoModules" in projects.config.json, or put { "autoModules": true, "exclude": ["common"] } in that repo's portfolio.json.
Module description = <description> in the module's pom.xml, otherwise the first sentence of its README.md.
Entries you list by hand in portfolio.json win over automatic ones.  
