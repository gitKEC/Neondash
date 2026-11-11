// Renvoie le numéro de version publié (commit Vercel) pour que l'appli se mette à jour toute seule.
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({ v: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || 'dev' }));
};
