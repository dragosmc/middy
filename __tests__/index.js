jest.mock('aws-sdk')

const SSM = require('aws-sdk/clients/ssm')
const STS = require('aws-sdk/clients/sts')

const middy = require('../../core')
const ssm = require('../')

describe('🔒 SSM Middleware', () => {
  const getParametersMock = jest.fn()
  SSM.prototype.getParameters = getParametersMock
  const getParametersByPathMock = jest.fn()
  SSM.prototype.getParametersByPath = getParametersByPathMock

  const assumeRoleMock = jest.fn()
  STS.prototype.assumeRole = assumeRoleMock

  const onChange = jest.fn()

  beforeEach(() => {
    getParametersMock.mockReset()
    getParametersMock.mockClear()
    getParametersByPathMock.mockReset()
    getParametersByPathMock.mockClear()
    assumeRoleMock.mockReset()
    assumeRoleMock.mockClear()
    onChange.mockReset()
    onChange.mockClear()
    delete process.env.KEY_NAME
  })

  async function testScenario ({ ssmMockResponse, ssmMockResponses, middlewareOptions, callbacks, delay = 0 }) {
    (ssmMockResponses || [ssmMockResponse]).forEach(ssmMockResponse => {
      getParametersMock.mockReturnValue({
        promise: () => Promise.resolve(ssmMockResponse)
      })

      getParametersByPathMock.mockReturnValueOnce({
        promise: () => Promise.resolve(ssmMockResponse)
      })
    })

    const handler = middy((event, context, cb) => {
      cb()
    })
    handler.use(ssm(middlewareOptions))

    const event = {}
    let promise = Promise.resolve()
    callbacks.forEach(cb => {
      const context = {}
      promise = promise.then(() => {
        return new Promise((resolve, reject) => {
          handler(event, context, (error, response) => {
            try {
              cb(error, { event, context, response })
              resolve()
            } catch (err) {
              reject(err)
            }
          })
        })
      }).then(() => {
        if (delay) {
          return new Promise((resolve) => {
            setTimeout(resolve, delay)
          })
        }
      })
    })

    await promise
  }

  test('It should set SSM param value to environment variable by default', async () => {
    await testScenario({
      ssmMockResponse: {
        Parameters: [{ Name: '/dev/service_name/key_name', Value: 'key-value' }]
      },
      middlewareOptions: {
        names: {
          KEY_NAME: '/dev/service_name/key_name'
        }
      },
      callbacks: [
        () => {
          expect(process.env.KEY_NAME).toEqual('key-value')
        }
      ]
    })
  })

  test('It should not call aws-sdk again if parameter is cached in env', async () => {
    await testScenario({
      ssmMockResponse: {
        Parameters: [{ Name: '/dev/service_name/key_name', Value: 'key-value' }]
      },
      middlewareOptions: {
        names: {
          KEY_NAME: '/dev/service_name/key_name'
        },
        cache: true
      },
      callbacks: [
        () => {
          expect(process.env.KEY_NAME).toEqual('key-value')
          expect(getParametersMock).toBeCalled()
          getParametersMock.mockClear()
        },
        () => {
          expect(process.env.KEY_NAME).toEqual('key-value')
          expect(getParametersMock).not.toBeCalled()
        }
      ]
    })
  })

  test('It should not call aws-sdk again if parameter is cached in context', async () => {
    await testScenario({
      ssmMockResponse: {
        Parameters: [{ Name: '/dev/service_name/secure_param', Value: 'something-secure' }]
      },
      context: {
        // simulate already cached value
        secureValue: '/dev/service_name/secure_param'
      },
      middlewareOptions: {
        names: {
          secureValue: '/dev/service_name/secure_param'
        },
        cache: true,
        setToContext: true
      },
      callbacks: [
        (_, { context }) => {
          expect(context.secureValue).toEqual('something-secure')
          expect(getParametersMock).toBeCalledWith({ Names: ['/dev/service_name/secure_param'], WithDecryption: true })
          getParametersMock.mockClear()
        },
        (_, { context }) => {
          expect(context.secureValue).toEqual('something-secure')
          expect(getParametersMock).not.toBeCalled()
        }
      ]
    })
  })

  test('It should call aws-sdk if cache enabled but param not cached', async () => {
    await testScenario({
      ssmMockResponse: {
        Parameters: [{ Name: '/dev/service_name/secure_param', Value: 'something-secure' }]
      },
      middlewareOptions: {
        names: {
          secureValue: '/dev/service_name/secure_param'
        },
        cache: true,
        setToContext: true,
        paramsLoaded: false
      },
      callbacks: [
        (_, { context }) => {
          expect(context.secureValue).toEqual('something-secure')
          expect(getParametersMock).toBeCalledWith({ Names: ['/dev/service_name/secure_param'], WithDecryption: true })
        }
      ]
    })
  })

  test('It should call onChange handler on first run', async () => {
    await testScenario({
      ssmMockResponse: {
        Parameters: [{ Name: '/dev/service_name/secure_param', Value: 'something-secure' }]
      },
      middlewareOptions: {
        names: {
          secureValue: '/dev/service_name/secure_param'
        },
        cache: true,
        onChange: onChange,
        setToContext: true,
        paramsLoaded: false
      },
      callbacks: [
        (_, { context }) => {
          expect(onChange).toHaveBeenCalledTimes(1)
          expect(context.secureValue).toEqual('something-secure')
          expect(getParametersMock).toBeCalledWith({ Names: ['/dev/service_name/secure_param'], WithDecryption: true })
        }
      ]
    })
  })

  test('It should call aws-sdk if cache enabled but cached param has expired', async () => {
    await testScenario({
      ssmMockResponse: {
        Parameters: [{ Name: '/dev/service_name/secure_param', Value: 'something-secure' }]
      },
      middlewareOptions: {
        names: {
          secureValue: '/dev/service_name/secure_param'
        },
        cache: true,
        cacheExpiryInMillis: 10,
        setToContext: true,
        paramsLoaded: false
      },
      callbacks: [
        (_, { context }) => {
          expect(context.secureValue).toEqual('something-secure')
          expect(getParametersMock).toBeCalledWith({ Names: ['/dev/service_name/secure_param'], WithDecryption: true })
          getParametersMock.mockClear()
        },
        (_, { context }) => {
          expect(context.secureValue).toEqual('something-secure')
          expect(getParametersMock).toBeCalledWith({ Names: ['/dev/service_name/secure_param'], WithDecryption: true })
        }
      ],
      delay: 20 // 20 > 10, so cache has expired
    })
  })

  test('It should call onChange along with aws-sdk if cache enabled but cached param has expired', async () => {
    await testScenario({
      ssmMockResponse: {
        Parameters: [{ Name: '/dev/service_name/secure_param', Value: 'something-secure' }]
      },
      middlewareOptions: {
        names: {
          secureValue: '/dev/service_name/secure_param'
        },
        cache: true,
        onChange: onChange,
        cacheExpiryInMillis: 10,
        setToContext: true,
        paramsLoaded: false
      },
      callbacks: [
        (_, { context }) => {
          expect(onChange).toHaveBeenCalledTimes(1)
          expect(context.secureValue).toEqual('something-secure')
          expect(getParametersMock).toBeCalledWith({ Names: ['/dev/service_name/secure_param'], WithDecryption: true })
          getParametersMock.mockClear()
        },
        (_, { context }) => {
          expect(onChange).toHaveBeenCalledTimes(2)
          expect(context.secureValue).toEqual('something-secure')
          expect(getParametersMock).toBeCalledWith({ Names: ['/dev/service_name/secure_param'], WithDecryption: true })
        }
      ],
      delay: 20 // 20 > 10, so cache has expired
    })
  })

  test('It should not call aws-sdk if cache enabled and cached param has not expired', async () => {
    await testScenario({
      ssmMockResponse: {
        Parameters: [{ Name: '/dev/service_name/secure_param', Value: 'something-secure' }]
      },
      middlewareOptions: {
        names: {
          secureValue: '/dev/service_name/secure_param'
        },
        cache: true,
        cacheExpiryInMillis: 50,
        setToContext: true,
        paramsLoaded: false
      },
      callbacks: [
        (_, { context }) => {
          expect(context.secureValue).toEqual('something-secure')
          expect(getParametersMock).toBeCalledWith({ Names: ['/dev/service_name/secure_param'], WithDecryption: true })
          getParametersMock.mockClear()
        },
        (_, { context }) => {
          expect(context.secureValue).toEqual('something-secure')
          expect(getParametersMock).not.toBeCalled()
        }
      ],
      delay: 20 // 20 < 50, so cache has not expired
    })
  })

  test('It should set SSM param value to context if set in options', async () => {
    await testScenario({
      ssmMockResponse: {
        Parameters: [{ Name: '/dev/service_name/secure_param', Value: 'something-secure' }]
      },
      middlewareOptions: {
        names: {
          secureValue: '/dev/service_name/secure_param'
        },
        setToContext: true
      },
      callbacks: [
        (_, { context }) => {
          expect(context.secureValue).toEqual('something-secure')
        }
      ]
    })
  })

  test('It should throw error when some SSM params are invalid', async () => {
    await testScenario({
      ssmMockResponse: {
        InvalidParameters: ['invalid-smm-param-name', 'another-invalid-ssm-param']
      },
      middlewareOptions: {
        names: {
          invalidParam: 'invalid-smm-param-name',
          anotherInvalidParam: 'another-invalid-ssm-param'
        }
      },
      callbacks: [
        (error) => {
          expect(error.message).toEqual('InvalidParameters present: invalid-smm-param-name, another-invalid-ssm-param')
        }
      ]
    })
  })

  test('It should not throw error when empty middleware params passed', async () => {
    await testScenario({
      ssmMockResponse: {},
      middlewareOptions: {},
      callbacks: [
        (error) => {
          expect(error).toBeFalsy()
        }
      ]
    })
  })

  test('It should set properties on target with names equal to full parameter name sans specified path', async () => {
    await testScenario({
      ssmMockResponse: {
        Parameters: [{ Name: '/dev/service_name/key_name', Value: 'key-value' }]
      },
      middlewareOptions: {
        paths: { '': '/dev/service_name' }
      },
      callbacks: [
        () => {
          expect(process.env.KEY_NAME).toEqual('key-value')
        }
      ]
    })
  })

  test('It should retrieve params from multiple paths', async () => {
    const ssmMockResponse = {
      Parameters: [{ Name: '/dev/service_name/key_name', Value: 'key-value' }]
    }
    await testScenario({
      ssmMockResponses: [ssmMockResponse, ssmMockResponse],
      middlewareOptions: {
        paths: { '': ['/dev/service_name'], prefix: '/dev' }
      },
      callbacks: [
        () => {
          expect(process.env.KEY_NAME).toEqual('key-value')
          expect(process.env.PREFIX_SERVICE_NAME_KEY_NAME).toEqual('key-value')
        }
      ]
    })
  })

  test('It should make multiple API calls for a single path if the response contains a token for additional params', async () => {
    await testScenario({
      ssmMockResponses: [
        {
          Parameters: [{ Name: '/dev/service_name/key_name1', Value: 'key-value1' }],
          NextToken: 'token'
        },
        {
          Parameters: [{ Name: '/dev/service_name/key_name2', Value: 'key-value2' }]
        }
      ],
      middlewareOptions: {
        paths: { '': ['/dev/service_name'] }
      },
      callbacks: [
        () => {
          expect(process.env.KEY_NAME1).toEqual('key-value1')
          expect(process.env.KEY_NAME2).toEqual('key-value2')
        }
      ]
    })
  })

  test('It should allow multiple option names to point at the same SSM path', async () => {
    await testScenario({
      ssmMockResponses: [
        {
          Parameters: [{ Name: '/dev/service_name/key_name', Value: 'key-value' }]
        }
      ],
      middlewareOptions: {
        names: {
          KEY_NAME_1: '/dev/service_name/key_name',
          KEY_NAME_2: '/dev/service_name/key_name'
        }
      },
      callbacks: [
        () => {
          expect(process.env.KEY_NAME_1).toEqual('key-value')
          expect(process.env.KEY_NAME_2).toEqual('key-value')
        }
      ]
    })
  })

  test('It should assume IAM role with the session name provided', async () => {
    const middlewareOptions = {
      stsOptions: {
        assumeRoleOptions: {
          RoleArn: 'arn::role-to-assume',
          RoleSessionName: 'middy-ssm-session-' + new Date().getTime()
        },
        awsSdkOptions: { region: 'us-west-2' }
      }
    }
    await testScenario({
      middlewareOptions,
      callbacks: [
        () => {
          expect(assumeRoleMock).toBeCalledWith(middlewareOptions.stsOptions.assumeRoleOptions)
          expect(assumeRoleMock).toBeCalledTimes(1)
        }
      ]
    })
  })

  test('It should not assume IAM role with wrong config', async () => {
    const middlewareOptions = {
      stsOptions: {
        awsSdkOptions: { region: 'us-west-2' }
      }
    }
    await testScenario({
      middlewareOptions,
      callbacks: [
        () => {
          expect(assumeRoleMock).toBeCalledTimes(0)
        }
      ]
    })
  })

  test('It should not assume IAM role with no config', async () => {
    const middlewareOptions = {
      awsSdkOptions: { region: 'us-west-2' }
    }
    await testScenario({
      middlewareOptions,
      callbacks: [
        () => {
          expect(assumeRoleMock).toBeCalledTimes(0)
        }
      ]
    })
  })

  test('It should assume IAM role and generate session name', async () => {
    const middlewareOptions = {
      stsOptions: {
        assumeRoleOptions: {
          RoleArn: 'arn::role-to-assume'
        }
      }
    }
    await testScenario({
      middlewareOptions,
      callbacks: [
        () => {
          expect(assumeRoleMock).toBeCalledWith(expect.objectContaining({
            ...middlewareOptions.stsOptions.assumeRoleOptions,
            RoleSessionName: expect.stringContaining('middy-ssm-session-')
          }))
          expect(assumeRoleMock).toBeCalledTimes(1)
        }
      ]
    })
  })

  test('It should assume IAM role with provided sdk config', async () => {
    const middlewareOptions = {
      stsOptions: {
        assumeRoleOptions: {
          RoleArn: 'arn::role-to-assume',
          RoleSessionName: 'middy-ssm-session-' + new Date().getTime()
        },
        awsSdkOptions: {
          credentials: {
            accessKeyId: 'aws-access-key'
          }
        }
      }
    }
    await testScenario({
      middlewareOptions,
      callbacks: [
        () => {
          expect(assumeRoleMock).toBeCalledTimes(1)
        }
      ]
    })
  })
})
