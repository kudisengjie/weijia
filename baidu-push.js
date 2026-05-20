const http = require('http');
const https = require('https');

const SITE = 'https://www.lxue.xin';
const TOKEN = 'KPTRIvNjOnPq3vdl';

const URLS = [
    'https://www.lxue.xin/',
    'https://www.lxue.xin/profile.html',
    'https://www.lxue.xin/solutions.html',
    'https://www.lxue.xin/geo-guide.html',
    'https://www.lxue.xin/insights.html',
    'https://www.lxue.xin/support.html'
];

function pushToBaidu() {
    const apiUrl = `http://data.zz.baidu.com/urls?site=${SITE}&token=${TOKEN}`;
    const postData = URLS.join('\n');

    const options = {
        hostname: 'data.zz.baidu.com',
        port: 80,
        path: `/urls?site=${encodeURIComponent(SITE)}&token=${TOKEN}`,
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                const result = JSON.parse(data);
                console.log('Baidu push result:', result);
                if (result.success) {
                    console.log(`Successfully pushed ${result.success} URLs`);
                }
                if (result.remain) {
                    console.log(`Remaining quota: ${result.remain}`);
                }
            } catch (e) {
                console.log('Response:', data);
            }
        });
    });

    req.on('error', (e) => {
        console.error('Push failed:', e.message);
    });

    req.write(postData);
    req.end();
}

pushToBaidu();