// Baked in at build time for `ng build --configuration production` via
// angular.json's fileReplacements — see design.md → D8. Placeholder: a real
// deployment sets this to the actual public auth origin (e.g.
// https://auth.example.com) before building this configuration, per the
// nginx-subdomain-topology capability (task 8.x).
export const environment = {
  authApiUrl: 'https://auth.example.com',
};
