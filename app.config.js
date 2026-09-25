// Expo reads app.json first and hands the result to this file, which adds the one setting that cannot live there.
//
// Android phones only receive notifications through Firebase, and Firebase identifies a project by a file called
// google-services.json. That file only exists once somebody has made a Firebase project, and the app has to build
// perfectly well before that - nobody should have to set up Firebase to try the app. So the setting is added only
// when the file is actually there, and left out when it is not.
//
// Two ways to give it:
//   - put google-services.json next to this file and commit it (what the README tells you to do), or
//   - keep it out of the repository and let EAS hand it over: `eas secret:create --name GOOGLE_SERVICES_JSON
//     --type file --value ./google-services.json`, which sets the path below during a cloud build.
//
// It is not a secret. It holds your Firebase project's numbers and an Android key tied to the package name, and a
// copy of it sits inside every APK you hand out. The file that *is* secret is the service-account key from Firebase
// -> Service accounts: that one goes to Expo through `eas credentials` and never comes near this repository.
const fs = require('fs');
const path = require('path');

const GOOGLE_SERVICES = process.env.GOOGLE_SERVICES_JSON || './google-services.json';

module.exports = ({ config }) => {
  const where = path.isAbsolute(GOOGLE_SERVICES) ? GOOGLE_SERVICES : path.join(__dirname, GOOGLE_SERVICES);
  if (!fs.existsSync(where)) return config;
  return { ...config, android: { ...config.android, googleServicesFile: GOOGLE_SERVICES } };
};
