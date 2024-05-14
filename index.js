const express = require('express');
const cors = require('cors');
const asyncHandler = require('express-async-handler');
const axios = require('axios');


const getTimestamp = () => {
    return new Date().toISOString();
};

function cleardata(dic) {
    Object.keys(dic).forEach(key => {
        delete dic[key];
    });
}

let nodeIPs = {
    0: "192.168.25.110:3000",   // ccd087
    1: "192.168.25.111:3000",   // ccd088
    2: "192.168.25.112:3000",   // ccd089
    3: "192.168.25.113:3000",   // ccd090
    4: "192.168.25.121:3000",   // ccd098
    5: "192.168.25.122:3000",   // ccd099
    6: "192.168.25.123:3000",   // ccd100
};

// let clientID = "localhost:8000";
let clientID = "192.168.25.110:8000"

let primaryNode = 0;

// stores responses for every sequence number in the current view
let responses = {};

let f = 2

let total_nodes = 3 * f + 1
// total_nodes = 2

function listComparision(l1, l2) {
    if (l1.length != l2.length) {
        return false;
    }

    for (let i = 0; i < l1.length; i++) {
        if (l1[i] != l2[i]) {
            return false;
        }
    }

    return true;
}

const request = async (req, res) => {
    const { message } = req.body;
    const url = `http://${nodeIPs[primaryNode]}/request`;
    const body = {
        type: 'REQUEST',
        message: message,
        timestamp: getTimestamp(),
        client: clientID
    };

    try {
        const response = await axios.post(url, body);
        const responseData = response.data;
        // console.log(responseData);

        const seq = responseData.seq;

        // console.log(responseData);

        // check is all the responses are received. If not do appropriate action
        setTimeout(async function () {
            const specResponseList = responses[seq];
            const responseList = []                                     // contains {"42","42","35",.....}
            for (key in specResponseList) {
                responseList.push(specResponseList[key].reply);
            }

            console.log(seq);

            let freq = {}                                               // contains {"42":2,"35":1,.....}
            for (key in responseList) {
                if (responseList[key] in freq) {
                    freq[responseList[key]] += 1;
                } else {
                    freq[responseList[key]] = 1;
                }
            }

            // find the majority response
            let majority = -1;                                          // contains the majority reply (42)
            let maxfreq = -1;                                           // contains the frequency of the majority reply(2)
            for (key in freq) {
                if (freq[key] > maxfreq) {
                    maxfreq = freq[key];
                    majority = key;
                }
            }
            
            // console.log(specResponseList, seq)
            let maj_response = specResponseList[0];
            for (key in specResponseList) {
                if (specResponseList[key].reply == majority) {
                    maj_response = specResponseList[key];
                    break;
                }
            }

            console.log("max freq is " + maxfreq);

            // check if there is a mistmatch in the history of the servers
            let unique_history_list = []

            for (key in specResponseList) {
                // if specResponseList[key].history not in unique_history_list)
                let found = false;
                for (key2 in unique_history_list) {
                    if (listComparision(specResponseList[key].history, unique_history_list[key2])) {
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    unique_history_list.push(specResponseList[key].history);
                }
            }

            if (unique_history_list.length > 1) {
                // send mismatch to all nodes
                // !!!!!!!!!!! < code here > !!!!!!!!!!!
                console.log("mismatch in history");
                const mismatch = {
                    type: 'MIS_MATCH',
                    view: maj_response.view,
                    seq: maj_response.seq
                };

                cleardata(responses);

                for (IP in nodeIPs) {
                    const url = `http://${nodeIPs[IP]}/request`;
                    const body = mismatch;
                    try {
                        await axios.post(url, body, { timeout: 5000 });
                    }
                    catch (error) {
                        if (error.code === 'ECONNABORTED') {
                            console.log("node " + IP + " request timed out");
                        } else {
                            console.log("node " + IP + " not responding");
                        }
                    }
                }

                res.json("Query failed due to mismatch in history");
            }
            else {

                if (maxfreq == total_nodes) {
                    res.json("Query submitted full match");
                }
                else if (maxfreq >= 2 * f + 1) {
                    // create a cc and send to all servers

                    const commit_cert = {
                        type: 'COMMIT_CERTIFICATE',
                        client: clientID,
                        view: maj_response.view,
                        seq: maj_response.seq,
                        OR: maj_response.OR,
                        last_message: majority,
                        history: unique_history_list[0]
                    };

                    // send the commit certificate to all the servers which have sent the spec response

                    let local_commiit_replies = [];

                    for (IP in nodeIPs) {
                        const url = `http://${nodeIPs[IP]}/request`;
                        const body = commit_cert;

                        console.log("sending cc to " + IP);

                        try {
                            const response = await axios.post(url, body, { timeout: 5000 });
                            local_commiit_replies.push(response.data);
                        }
                        catch (error) {
                            if (error.code === 'ECONNABORTED') {
                                console.log("node " + IP + " request timed out");
                            } else {
                                console.log("node " + IP + " not responding");
                            }
                        }
                    }

                    console.log(local_commiit_replies.length);

                    if (local_commiit_replies.length >= 2 * f + 1) {
                        res.json("Query submitted sent cc");
                    }
                    else {
                        res.json("sent cc but < 2*f+1 replies received");
                    }

                    // res.send("this is issue probably")
                }
                else {
                    // resend the query to all the servers
                    const mismatch = {
                        type: 'MIS_MATCH',
                        view: maj_response.view,
                        seq: maj_response.seq,
                        lets: "see"
                    };

                    cleardata(responses);
    
                    for (IP in nodeIPs) {
                        const url = `http://${nodeIPs[IP]}/request`;
                        const body = mismatch;
                        try {
                            console.log("sending mismatch to " + IP)
                            await axios.post(url, body);
                        }
                        catch (error) {
                            if (error.code === 'ECONNABORTED') {
                                console.log("node " + IP + " request timed out for sending mismatch");
                            } else {
                                console.log("node " + IP + " not responding");
                            }
                        }
                    }
                    res.json("Query failed");
                }
            }
        }, 5000);

        // res.json(responseData);
    } catch (error) {
        res.send(error)
    }
}

const specResponse = async (req, res) => {
    const spec_response = req.body;
    // console.log(spec_response);
    const reply = spec_response.reply;

    primaryNode = spec_response.view;

    if (!responses[spec_response.seq]) {
        responses[spec_response.seq] = [];
    }
    responses[spec_response.seq].push(spec_response);

    // console.log(responses);

    res.status(200).send('response received');
}

const getResponses = (req, res) => {
    res.json(responses);
}


const app = express();
app.use(cors());
app.use(express.json());

const port = 8000;

app.listen(port, () => {
    console.log(`client running on port ${port}.`);
});

app.post('/request', asyncHandler(request));
app.post('/specresponse', asyncHandler(specResponse));
app.get('/responses', getResponses);



app.get('/test', (req, res) => {
    res.send('Hello World!');
});