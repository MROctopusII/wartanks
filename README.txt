Wartanks Online - GitHub Pages + Render root layout

IMPORTANT:
This build has NO public/ folder.
GitHub Pages needs these files in the repository root:
- index.html
- styles.css
- game.js
- images/

Render needs these server files in the same repository root:
- server.js
- package.json

Render setup:
Build Command: npm install
Start Command: npm start

How to play with GitHub Pages frontend + Render server:
1. Deploy this whole repository to Render as a Web Service.
2. Deploy the same root files to GitHub Pages.
3. Open the GitHub Pages site.
4. In the title screen Server box, type only your Render host, for example:
   wartanks-online.onrender.com
5. Press Play.

Alternative:
Open the GitHub Pages URL with query param:
?server=wartanks-online.onrender.com

If you open the Render app URL directly, the Server box can stay empty because the frontend and WebSocket are on the same host.
