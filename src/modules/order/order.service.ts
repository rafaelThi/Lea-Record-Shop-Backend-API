import { Injectable, ConflictException, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { FilterOrderDto } from './dto/filter-order.dto';
import { CustomerService } from '../customer/customer.service';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
    @InjectQueue('orders')
    private readonly orderQueue: Queue,
    private readonly customerService: CustomerService,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateOrderDto): Promise<{
    orderId: string;
    status: string;
    message: string;
  }> {
    await this.customerService.findActiveOrFail(dto.customerId);

    const reservations: { discId: string; quantity: number }[] = [];

    try {
      for (const item of dto.items) {
        const reserved = await this.reserveStock(item.discId, item.quantity);

        if (!reserved) {
          await this.rollbackReservations(reservations);
          throw new ConflictException({
            message: 'Insufficient stock for this disc',
            discId: item.discId,
          });
        }

        reservations.push({ discId: item.discId, quantity: item.quantity });
      }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      await this.rollbackReservations(reservations);
      throw error;
    }

    const order = this.orderRepository.create({
      customerId: dto.customerId,
      status: OrderStatus.PENDING,
      orderedAt: new Date(),
    });

    const savedOrder = await this.orderRepository.save(order);

    const items = dto.items.map((item) =>
      this.orderItemRepository.create({
        orderId: savedOrder.id,
        discId: item.discId,
        quantity: item.quantity,
      }),
    );

    await this.orderItemRepository.save(items);

    await this.orderQueue.add(
      'process-order',
      {
        orderId: savedOrder.id,
        items: dto.items,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );

    return {
      orderId: savedOrder.id,
      status: 'PENDING',
      message: 'Order received and will be processed shortly.',
    };
  }

  async findAll(
    filter: FilterOrderDto,
  ): Promise<{ data: Order[]; total: number; page: number; limit: number }> {
    const { customerId, startDate, endDate, page, limit } = filter;

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('items.disc', 'disc')
      .leftJoinAndSelect('order.customer', 'customer');

    if (customerId) {
      qb.andWhere('order.customerId = :customerId', { customerId });
    }

    if (startDate) {
      qb.andWhere('order.orderedAt >= :startDate', { startDate });
    }

    if (endDate) {
      qb.andWhere('order.orderedAt <= :endDate', { endDate });
    }

    qb.orderBy('order.orderedAt', 'DESC');
    qb.skip((page - 1) * limit);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['items', 'items.disc', 'customer'],
    });

    if (!order) {
      throw new ConflictException(`Order with id ${id} not found`);
    }

    return order;
  }

  private async reserveStock(
    discId: string,
    quantity: number,
  ): Promise<boolean> {
    try {
      const remaining = await this.redis.decrby(
        `stock:disc:${discId}`,
        quantity,
      );

      if (remaining < 0) {
        await this.redis.incrby(`stock:disc:${discId}`, quantity);
        return false;
      }

      return true;
    } catch (redisError) {
      this.logger.warn(
        'Redis unavailable, falling back to Postgres lock',
        redisError,
      );
      return this.reserveStockPostgres(discId, quantity);
    }
  }

  private async reserveStockPostgres(
    discId: string,
    quantity: number,
  ): Promise<boolean> {
    const result = await this.dataSource.query(
      `UPDATE discs SET quantity = quantity - $1
       WHERE id = $2 AND quantity >= $1
       RETURNING quantity`,
      [quantity, discId],
    );
    return result.length > 0;
  }

  private async rollbackReservations(
    reservations: { discId: string; quantity: number }[],
  ): Promise<void> {
    for (const r of reservations) {
      try {
        await this.redis.incrby(`stock:disc:${r.discId}`, r.quantity);
      } catch {
        this.logger.error(
          `Failed to rollback Redis reservation for disc ${r.discId}`,
        );
      }
    }
  }
}
