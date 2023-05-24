# Starknet Bridge Relayer
Starknet Relay is a service that consumes Starknet withdrawals on L1. When the user bridges the tokens from L2 to L1, it is possible to automate the process of withdrawing the tokens on L1 by paying the gas fee on L2 to the wallet relayer. The relayer will detect that the user did the payment and then calls the withdrawal function when the message reaches L1

## Development

### Install
Install packages
```sh
yarn
```

### Start development
#### Setup env
Duplicate the `example.env` file and rename it to `.env`

```sh
yarn start:dev
```

### Access swagger UI
```sh
http://0.0.0.0:3000/api
```

### Prometheus metrics
```sh
http://0.0.0.0:3000/metric
```

### Get Gas cost
```sh
http://0.0.0.0:3000/api/v1/gas-cost/{timestamp}
```

### Tests
#### Run unit tests
```sh
yarn test
```

#### Run e2e tests
1. Start the services
```sh
cd e2e
```
2. Start the services
```sh
make e2e-up
```
3. Restore the database
```sh
make e2e-setup
```
4. Run tests
```sh
make e2e-test
```
