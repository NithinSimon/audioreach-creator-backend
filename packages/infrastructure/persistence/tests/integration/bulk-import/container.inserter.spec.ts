/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import type {DataSource, EntityManager} from 'typeorm';
import {Container} from '@arc/core';
import {
  setupIntegrationTest,
  teardownIntegrationTest,
  setupEachTest,
  getTestDataSource,
} from '../helpers/test-database-setup.js';
import {ContainerInserter} from '../../../src/persistence-typeorm-sqllite/repositories/bulk-import/container/container.inserter.js';
import type {IdGenerationPort} from '@arc/core';

// ─── Constants ────────────────────────────────────────────────────────────────

const FILE_ID = 100;
const CONTAINER_TYPE_ID = 500;
const CONTAINER_TYPE_NAME = 'APM';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createFkDependencies(manager: EntityManager): Promise<void> {
  await manager.insert('Project', {
    systemId: 1,
    name: 'Test Project',
    description: 'Test',
    type: 'Offline',
    version: 1,
  });

  await manager.insert('ArcDbFile', {
    systemId: FILE_ID,
    projectSystemId: 1,
    fileName: 'test.awsp',
    description: '',
    metadata: '{}',
    isTarget: 0,
    lastReservedId: 0,
    version: 1,
  });

  await manager.insert('ContainerType', {
    systemId: CONTAINER_TYPE_ID,
    name: CONTAINER_TYPE_NAME,
    value: 1,
    version: 1,
  });
}

function buildContainer(systemId: number, containerTypeSystemId = CONTAINER_TYPE_ID): Container {
  return new Container(systemId, systemId, containerTypeSystemId, FILE_ID);
}

const noOpIdGeneration: IdGenerationPort = {
  getNextId: async () => { throw new Error('not expected in this test'); },
  reserveBlock: async () => {},
  persistActual: async () => {},
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContainerInserter', () => {
  let dataSource: DataSource;
  let manager: EntityManager;
  let inserter: ContainerInserter;

  beforeAll(async () => {
    await setupIntegrationTest();
    dataSource = getTestDataSource();
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  beforeEach(async () => {
    await setupEachTest();
    manager = dataSource.manager;
    await createFkDependencies(manager);
    inserter = new ContainerInserter(manager, noOpIdGeneration);
  });

  it('returns okBulkInsert for empty input', async () => {
    const result = await inserter.insert([]);
    expect(result.ok).toBe(true);
  });

  it('inserts a container row with containerTypeSystemId', async () => {
    const result = await inserter.insert([buildContainer(1000)]);

    expect(result.ok).toBe(true);

    const rows = await dataSource.query(
      `SELECT * FROM containers WHERE system_id = 1000`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].container_type_system_id).toBe(CONTAINER_TYPE_ID);
    expect(rows[0].file_system_id).toBe(FILE_ID);
  });

  it('resolves containerType.name via join', async () => {
    await inserter.insert([buildContainer(1001)]);

    const row = await dataSource
      .createQueryBuilder('Container', 'c')
      .leftJoinAndSelect('c.containerType', 'containerType')
      .where('c.systemId = :id', {id: 1001})
      .getOne();

    expect(row).not.toBeNull();
    expect(row!.containerType).not.toBeNull();
    expect(row!.containerType!.name).toBe(CONTAINER_TYPE_NAME);
    expect(row!.containerType!.systemId).toBe(CONTAINER_TYPE_ID);
  });

  it('inserts container with null containerTypeSystemId (upload-path placeholder)', async () => {
    const container = new Container(1002, 1002, null, FILE_ID);
    const result = await inserter.insert([container]);

    expect(result.ok).toBe(true);

    const rows = await dataSource.query(
      `SELECT container_type_system_id FROM containers WHERE system_id = 1002`,
    );
    expect(rows[0].container_type_system_id).toBeNull();
  });

  it('reports failure when containerTypeSystemId FK does not exist', async () => {
    const container = buildContainer(1003, 9999);

    const result = await inserter.insert([container]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toHaveLength(1);

    const rows = await dataSource.query(
      `SELECT * FROM containers WHERE system_id = 1003`,
    );
    expect(rows).toHaveLength(0);
  });
});
