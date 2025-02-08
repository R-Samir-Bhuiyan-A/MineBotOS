module.exports = {
  init(app) {
    console.log("✅ API Plugin has been loaded!");

    // Define a test API route
    app.get('/api/test', (req, res) => {
      console.log("📡 API Test Endpoint Accessed!");
      res.json({ message: "API Plugin is working!" });
    });
  }
};
