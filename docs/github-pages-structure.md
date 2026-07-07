# GitHub Pages Project Structure

```text
aiseelearn.com/
  index.html
  unit1-dialogue-task-check.html
  CNAME
  .nojekyll
  README.md
  assets/
    css/
      styles.css
    js/
      app.js
    videos/
      B3_U1_Dialogue_Part1_TaskCheck.mp4
    images/
      B3_U1_Dialogue_Part1_TaskCheck_preview.png
  docs/
    github-pages-structure.md
```

## First-Version Decisions

- The site is static so it can run on GitHub Pages.
- Student answers are not sent to a server.
- Answers and progress are saved only in the same browser with `localStorage`.
- The Unit 1 page is designed as a lesson-flow test, not a final LMS.
- The video is intentionally compact so students can listen and fill the table at the same time.
- The Word Bank remains visible while students work.

## Route Plan

- `/` opens the course home page.
- `/unit1-dialogue-task-check.html` opens the B3 U1 Dialogue Part 1 task.

## Future Data Model

The current frontend state can later map to a learning-history database:

```json
{
  "studentAlias": "80105",
  "lessonId": "b3-u1-dialogue-part1",
  "path": "S3",
  "taskStatus": "in_progress",
  "answers": {
    "zacPlace": "India",
    "zacWeather": "hot, rained",
    "zacThing": "",
    "jamiePlace": "Australia",
    "jamieWeather": "cold, snowed",
    "jamieThing": "postcard"
  },
  "reflection": "",
  "updatedAt": "2026-07-07T00:00:00.000Z"
}
```
