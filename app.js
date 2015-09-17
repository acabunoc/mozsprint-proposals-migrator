var express = require("express");
var app = express();
var mkdirp = require("mkdirp");
var fs = require("fs");
var chalk = require("chalk");
var GoogleSpreadsheet = require("google-spreadsheet");
var moment = require("moment");
var generateIssue = require("./generate-github-issue");
var githubRequest = require("./github-request");

var Habitat = require("habitat");
Habitat.load(".env");
var env = new Habitat("", {
  port: 5000
});

var GITHUB_API_ENDPOINT = "https://api.github.com";
var ROW_NUMBER_TO_START = 451; // this is the row # you want to fetch proposal data from. e.g., 2 means you want to fetch data from the first submitted proposal (Row#2)  
var TOTAL_ROWS_TO_FETCH = 44;
var POST_TO_GITHUB_DELAY_SECS = 3;
var LOG_DIR_PATH = "./export-log";

app.set("port", env.get("port"));

app.get("/", function(req, res) {
  res.send("Hello World :D");
});

var allProposals = [];
var numProposals = 0;
var numFetched = 0;
var fetchOptions = {
  start: ROW_NUMBER_TO_START-1, // minus 1 to offset the GoogleSpreadsheet default config, do not chnage this
  num: TOTAL_ROWS_TO_FETCH
};
var postLog = {
  numMigrated: 0,
  numFailed: 0,
  numIgnored: 0,
  rowsFailed: [],
  rowsIgnored: []
};

fetchDataFromSpreadsheet(env.get("GOOGLE_SPREADSHEET_ID"), fetchOptions, function(rows) {
  allProposals = rows;
  numProposals = allProposals.length;
  postToGitHubWithDelay();
});

function postToGitHubWithDelay() {
  setTimeout(function(){
    var proposal = allProposals[0+numFetched];
    var rowNum = ROW_NUMBER_TO_START + numFetched;
    if ( numFetched < numProposals ){
      if (proposal.dontmigrate) {
        postLog.numIgnored++;
        postLog.rowsIgnored.push(rowNum);
        console.log(chalk.yellow("Row #" + rowNum + " was ignored"));
        numFetched++;
        printCurrentReport();
        postToGitHubWithDelay();
      } else {
        postIssue( generateIssue(proposal, rowNum), function(error, successMsg) {
          if (error) {
            console.log(chalk.red(error));
            postLog.numFailed++;
            postLog.rowsFailed.push(rowNum);
          } else {
            console.log(chalk.green(successMsg));
            postLog.numMigrated++;
          }
          numFetched++;
          printCurrentReport();

          // print out the final result
          if ( (postLog.numMigrated+postLog.numFailed+postLog.numIgnored) == TOTAL_ROWS_TO_FETCH ) {
            var timestamp = moment(Date.now()).format("YYYYMMD-hh.mm.ssA");
            printFinalReport( generateFinalReport(timestamp) );
            writeToLogFile( generateFinalReport(timestamp) );
          }

          postToGitHubWithDelay();
        });
      }
    } else {
      console.log("/// DONE ///");
    }
  }, POST_TO_GITHUB_DELAY_SECS*1000);
}

function fetchDataFromSpreadsheet(spreadsheetID, options, cb) {
  var my_sheet = new GoogleSpreadsheet(spreadsheetID);
  my_sheet.getRows(2, options, function(err, rows){
    // console.log(Object.keys(rows[0]));
    cb(rows);
  })
}

function postIssue(issue, cb) {
  var options = {
    method: "POST",
    url: GITHUB_API_ENDPOINT + "/repos/" + env.get("GITHUB_REPO") + "/issues",
    body: {
      title: issue.title,
      body: issue.body
    }
  };
  var userCreds = {
    username: env.get("GITHUB_USERNAME"),
    password: env.get("GITHUB_PASSWORD")
  };

  githubRequest(options, userCreds, function(error, response, body) {
    if (error) {
      cb(err);
    } 

    if (response.statusCode != 200 && response.statusCode != 201) {
      cb(new Error("Response status HTTP " + response.statusCode + ", Github error message: " + response.body.message));
    } else {
      cb(null, "Successfully migrated '" + issue.title + "' (Issue #" + body.number + ")");
    }
    // console.log("\n\n response", response);
  });
}

function generateCurrentReport() {
  return  "numFetched = " + numFetched + "\n" +
          "  numMigrated: " + postLog.numMigrated + "\n" +
          "  numFailed: " + postLog.numFailed + "\n" +
          "  numIgnored: " + postLog.numIgnored + "\n";
}

function generateFinalReport(timestamp) {
  return  {
    header: "\n\n////////// Batch Posting Done //////////",
    timestamp: timestamp,
    detail: "Starts from Rows #" + ROW_NUMBER_TO_START + "\n" +
            "Total Rows Fetched: " + numFetched + " (Expected: " + TOTAL_ROWS_TO_FETCH + ")" + "\n" +
            "  numMigrated: " + postLog.numMigrated + "\n" +
            "  numFailed: " + postLog.numFailed + " (Rows #" + postLog.rowsFailed.join(", ") + ")" + "\n" +
            "  numIgnored: " + postLog.numIgnored + " (Rows #" + postLog.rowsIgnored.join(", ") + ")",
    footer: "////////////////////////////////////////\n\n"
  }
}

function printCurrentReport() {
  console.log(generateCurrentReport());
}

function printFinalReport(finalReport) {
  console.log( chalk.bgMagenta.bold(finalReport.header) );
  console.log( chalk.magenta(finalReport.timestamp) );
  console.log( "--------------------");
  console.log( chalk.magenta(finalReport.detail) );
  console.log( chalk.bgMagenta.bold(finalReport.footer) );
}

function printProposal() {
  setTimeout(function(){
    if ( numFetched < numProposals ){
      var currentProposal = allProposals[0+numFetched];
      console.log(currentProposal.sessionname);
      printProposal();
      numFetched++;
      console.log("numFetched = ", numFetched);
      console.log("\n");
    } else {
      console.log("/// ELSE ///");
    }
  }, POST_TO_GITHUB_DELAY_SECS*1000);
}

function writeToLogFile(finalReport) {
  var fileContent = finalReport.header + "\n" +
                    finalReport.timestamp + "\n" +
                    finalReport.detail + "\n" +
                    finalReport.footer;

  mkdirp(LOG_DIR_PATH, function (err) {
    if (err) {
      console.error(err);
    }
    else {
      var filePath = LOG_DIR_PATH + "/" + finalReport.timestamp + ".txt";
      fs.writeFile(filePath, fileContent, function(err) {
        if(err) {
          console.log(err);
        }
        console.log(filePath + " was saved!");
      }); 
    }
  });
}


app.listen(app.get("port"), function() {
  console.log(chalk.cyan("Server listening on port %d...\n"), app.get("port"));
});
