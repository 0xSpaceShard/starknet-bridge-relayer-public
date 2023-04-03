#!/bin/bash
yarn e2e:node --fork ${RPC_URL} & sleep 5 && yarn e2e:setup && tail -f /dev/null