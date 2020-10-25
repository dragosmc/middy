const STS = require('aws-sdk/clients/sts')

const assumeRoleOptionsDefaults = {
  RoleSessionName: 'SESSION_NAME_PREFIX' + new Date().getTime()
}

const defaults = {
  awsSdkOptions: {
    maxRetries: 6, // lowers a chance to hit service rate limits, default is 3
    retryDelayOptions: { base: 200 }
  },
  onChange: undefined,
  paths: {},
  names: {},
  setToContext: false,
  cache: false,
  cacheExpiryInMillis: undefined,
  paramsLoaded: false,
  paramsCache: undefined,
  paramsLoadedAt: new Date(0),
  assumeRoleOptions: {
    RoleArn: 'arn:aws:iam::311821845179:role/dev-tenant-service-cross-account-ro-role',
  }
}

const options = Object.assign({}, defaults)


const test = async () => {
  const stsInstance = new STS({
    maxRetries: 6, // lowers a chance to hit service rate limits, default is 3
    retryDelayOptions: { base: 200 }
  });


  const assume = {
    ...assumeRoleOptionsDefaults,
    ...options.assumeRoleOptions
  }
  const assumedRole = await stsInstance.assumeRole(assume).promise()

  console.log(assumedRole)

}

test()
