const express = require("express");
const bodyParser = require("body-parser");
const submissionController = require("./controllers/submission.controller");

const app = express();

app.use(bodyParser.json());

app.post("/submit", submissionController.runSubmission);

app.listen(5000, () => {
    console.log("Judge server running on port 5000");
});