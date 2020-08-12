<img alttext="COVID Green Logo" src="https://raw.githubusercontent.com/lfph/artwork/master/projects/covidgreen/stacked/color/covidgreen-stacked-color.png" width="300" />

# Region specific AWS Lambda Function Implementations

These lambdas are specific to New York State.

### Configuration & Secrets

The lambdas throughout use varied sets of configuration settings and secrets.

#### Non Secret Settings

| .env | AWS Property Key | Description |
| :--- | :--- | :--- |
| `AWS_REGION` | None | ?? |
| `DB_HOST` | `db_host` | ?? |
| `DB_PORT` | `db_port` | ?? |
| `DB_DATABASE` | `db_database` | ?? |
| `DB_SSL` | `db_ssl` | ?? |
| `STATS_URL` | `arcgis_url` | ?? |
| `ASSETS_BUCKET` | `s3_assets_bucket` | ?? |
| `SMS_TEMPLATE` | `sms_template` | ?? |
| `SMS_QUEUE_URL` | `sms_url` | ?? |
| `CALLBACK_QUEUE_URL` | `callbackQueueUrl` | AWS Queue where callback requests from the Backend API are read from |

#### Secret Settings

| .env | AWS Secret Key | Field | Meaning
| :--- | :--- | :--- | :--- |
| `AWS_POST_CALLBACK_AUTHENTICATION_URL` | `awsPostCallback` | `awsPostCallbackAuthnUrl` | URL used to authenticate calls into AWS Post Callback endpoint |
| `AWS_POST_CALLBACK_AUTHENTICATION_CLIENT_ID` | `awsPostCallback` | `awsPostCallbackAuthnClientId` | Client ID used to authenticate calls into AWS Post Callback endpoint |
| `AWS_POST_CALLBACK_AUTHENTICATION_CLIENT_SECRET` | `awsPostCallback` | `awsPostCallbackAuthnClientSecret` | Client Secret used to authenticate calls into AWS Post Callback endpoint |
| `AWS_POST_CALLBACK_URL` | `awsPostCallback` | `awsPostCallbackUrl` | URL of AWS queue to post callback requests onto |
| `AWS_POST_CALLBACK_APIKEY` | `awsPostCallback` | `awsPostCallbackAPIKey` | API Key required when posting callback requests |
| `CCT_URL` | `cct` | `url` | ?? |
| `CCT_ACCESS_GUID` | `cct` | `accessGuid` | ?? |
| `CCT_API_VERSION` | `cct` | `apiVersion` | ?? |
| `CCT_SP` | `cct` | `sp` | ?? |
| `CCT_SV` | `cct` | `sv` | ?? |
| `CCT_SIG` | `cct` | `sig` | ?? |
| `CSO_PUBLIC_KEY` | `cso` | `publicKey` | ?? |
| `CSO_SFTP_HOST` | `cso` | `host` | ?? |
| `CSO_SFTP_PORT` | `cso` | `port` | ?? |
| `CSO_SFTP_USER` | `cso` | `username` | ?? |
| `CSO_SFTP_PASSWORD` | `cso` | `password` | ?? |
| `CSO_CHECK_IN_PAT` | `cso` | `checkInPath` | ?? |
| `DB_USER` | `rds-read-write` | `username` | Database username |
| `DB_PASSWORD` | `rds-read-write` | `password` | Database password |
| `TWILIO_ACCOUNT_SID` | `sms` | `twilio_account` | ?? |
| `TWILIO_FROM` | `sms` | `twilio_from` | ?? |
| `TWILIO_MESSAGING_SERVICE_SID` | `sms` | `twilio_sid` | ?? |
| `TWILIO_AUTH_TOKEN` | `sms` | `twilio_token` | ?? |

### Callback

The `callback` lambda reads messages off an AWS message queue and posts them to the AWS Connect queue linked into the New York State call center process. The complete flow is as follows:

1. User creates callback request in the app and provides their preferred callback phone #
1. The Backend API [`/callback` endpoint](https://github.com/project-vagabond/covid-green-backend-api/blob/nys/lib/routes/callback/index.js#L51) executes and adds a message to the AWS queue at URL `callbackQueueUrl`
1. Lambda [`callback` lambda](callback.js) executes reading N messages off of `callbackQueueUrl` AWS queue.
   1. Makes POST call to `awsPostCallbackAuthnUrl` to authenticate and get a JWT allowing it to post messages to AWS queue at URL `awsPostCallbackUrl`
      1. If fails to get JWT then an exception is thrown and lambda exits
   1. For each message, makes POST call to `awsPostCallbackUrl` with API Key, JWT, and phone number
      1. If fails, then message is added back to `callbackQueueUrl` with a 10 minute delay to be retried.
   1. At this point the callback request has been added to the correct AWS queue for it to be routed in the New York State call center and handled

## Team

### Lead Maintainers

* @colmharte - Colm Harte <colm.harte@nearform.com>
* @jasnell - James M Snell <jasnell@gmail.com>
* @aspiringarc - Gar Mac Críosta <gar.maccriosta@hse.ie>

### Core Team

* @ShaunBaker - Shaun Baker <shaun.baker@nearform.com>
* @floridemai - Paul Negrutiu <paul.negrutiu@nearform.com>
* @jackdclark - Jack Clark <jack.clark@nearform.com>
* @andreaforni - Andrea Forni <andrea.forni@nearform.com>
* @jackmurdoch - Jack Murdoch <jack.murdoch@nearform.com>

### Contributors

* @dennisgove - Dennis Gove <dpgove@gmail.com>
* TBD

### Past Contributors

* TBD
* TBD

## Hosted By

<a href="https://www.lfph.io"><img alttext="Linux Foundation Public Health Logo" src="https://raw.githubusercontent.com/lfph/artwork/master/lfph/stacked/color/lfph-stacked-color.svg" width="200"></a>

[Linux Foundation Public Health](https://www.lfph.io)

## Acknowledgements

<a href="https://www.hse.ie"><img alttext="HSE Ireland Logo" src="https://www.hse.ie/images/hse.jpg" width="200" /></a><a href="https://nearform.com"><img alttext="NearForm Logo" src="https://openjsf.org/wp-content/uploads/sites/84/2019/04/nearform.png" width="400" /></a>

## License

Copyright (c) 2020 HSEIreland
Copyright (c) The COVID Green Contributors

[Licensed](LICENSE) under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
