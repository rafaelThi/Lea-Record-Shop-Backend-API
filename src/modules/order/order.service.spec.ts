import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { Repository, DataSource } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { OrderService } from './order.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CustomerService } from '../customer/customer.service';

describe('OrderService', () => {
  let service: OrderService;
  let orderRepository: jest.Mocked<Partial<Repository<Order>>>;
  let orderItemRepository: jest.Mocked<Partial<Repository<OrderItem>>>;
  let redis: Record<string, jest.Mock>;
  let queue: Record<string, jest.Mock>;
  let customerService: Partial<CustomerService>;
  let dataSource: Partial<DataSource>;

  const mockOrder: Partial<Order> = {
    id: '123e4567-e89b-12d3-a456-426614174010',
    customerId: '123e4567-e89b-12d3-a456-426614174001',
    status: OrderStatus.PENDING,
    orderedAt: new Date(),
    createdAt: new Date(),
    items: [],
  };

  beforeEach(async () => {
    orderRepository = {
      create: jest.fn().mockReturnValue(mockOrder),
      save: jest.fn().mockResolvedValue(mockOrder),
      findOne: jest.fn().mockResolvedValue(mockOrder),
      createQueryBuilder: jest.fn().mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockOrder], 1]),
      }),
    };

    orderItemRepository = {
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockResolvedValue([]),
    };

    redis = {
      decrby: jest.fn().mockResolvedValue(499),
      incrby: jest.fn().mockResolvedValue(500),
    };

    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    customerService = {
      findActiveOrFail: jest.fn().mockResolvedValue({
        id: '123e4567-e89b-12d3-a456-426614174001',
        active: true,
      }),
    };

    dataSource = {
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        {
          provide: getRepositoryToken(OrderItem),
          useValue: orderItemRepository,
        },
        { provide: 'REDIS_CLIENT', useValue: redis },
        { provide: getQueueToken('orders'), useValue: queue },
        { provide: CustomerService, useValue: customerService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  describe('create', () => {
    it('should reserve stock in Redis and enqueue order', async () => {
      const result = await service.create({
        customerId: '123e4567-e89b-12d3-a456-426614174001',
        items: [
          {
            discId: '123e4567-e89b-12d3-a456-426614174000',
            quantity: 1,
          },
        ],
      });

      expect(result.status).toBe('PENDING');
      expect(result.orderId).toBeDefined();
      expect(redis.decrby).toHaveBeenCalledWith(
        'stock:disc:123e4567-e89b-12d3-a456-426614174000',
        1,
      );
      expect(queue.add).toHaveBeenCalledWith(
        'process-order',
        expect.objectContaining({ orderId: mockOrder.id }),
        expect.any(Object),
      );
    });

    it('should throw ConflictException when stock is insufficient', async () => {
      redis.decrby.mockResolvedValue(-1);

      await expect(
        service.create({
          customerId: '123e4567-e89b-12d3-a456-426614174001',
          items: [
            {
              discId: '123e4567-e89b-12d3-a456-426614174000',
              quantity: 1,
            },
          ],
        }),
      ).rejects.toThrow(ConflictException);

      expect(redis.incrby).toHaveBeenCalledWith(
        'stock:disc:123e4567-e89b-12d3-a456-426614174000',
        1,
      );
    });

    it('should rollback all reservations if one item fails', async () => {
      redis.decrby.mockResolvedValueOnce(99).mockResolvedValueOnce(-1);

      await expect(
        service.create({
          customerId: '123e4567-e89b-12d3-a456-426614174001',
          items: [
            { discId: 'disc-1', quantity: 1 },
            { discId: 'disc-2', quantity: 1 },
          ],
        }),
      ).rejects.toThrow(ConflictException);

      expect(redis.incrby).toHaveBeenCalledWith('stock:disc:disc-2', 1);
      expect(redis.incrby).toHaveBeenCalledWith('stock:disc:disc-1', 1);
    });

    it('should fallback to Postgres if Redis is unavailable', async () => {
      redis.decrby.mockRejectedValue(new Error('Redis connection refused'));
      (dataSource.query as jest.Mock).mockResolvedValue([{ quantity: 499 }]);

      const result = await service.create({
        customerId: '123e4567-e89b-12d3-a456-426614174001',
        items: [
          {
            discId: '123e4567-e89b-12d3-a456-426614174000',
            quantity: 1,
          },
        ],
      });

      expect(result.status).toBe('PENDING');
      expect(dataSource.query).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated orders with filters', async () => {
      const result = await service.findAll({
        customerId: '123e4567-e89b-12d3-a456-426614174001',
        page: 1,
        limit: 20,
      });

      expect(result.data).toEqual([mockOrder]);
      expect(result.total).toBe(1);
    });
  });
});
